# FLEET 설계 (초안)

[English](fleet.md) · **한국어**

atc는 팀 세션 하나를 AIRCRAFT(`TEAM_B`, callsign BRAVO)로, 그 리더를 CAPTAIN으로 안다. 팀에 대해 아는 것은 그것뿐이다. 누가 타고 있는지, 어떤 일을 날 수 있는지, 주로 어느 프로젝트를 나는지, 무엇을 목표로 하는지 모른다. FLIGHT에 대해서도 마찬가지다. 큰 구현인지, 빠른 수정인지, 조사인지, 리뷰인지 모른다. 이 문서는 두 쪽을 항공사 운항 용어로 더한다.

- **FLEET**: 팀, 그 CREW, 자격(rating), ROUTE, TARGETS.
- **FLIGHT 분류**: 일의 종류, 크기, 필요한 rating.

> 상태: 설계 초안(2026-09-26, 2026-09-27 갱신). 지금까지 만든 것:
>
> - TAIL ASSIGNMENT(`tail:TEAM_X`. `lane:TEAM_X`는 2026-10-10까지 별칭으로 읽음)
> - FLEET 등록부와 탭(구현 순서 2번)
> - 관찰한 CREW와 CREW CHANGE 1·2단계(8.3, 8.4. OCC가 보내는 2단계는 DISPATCH approval 모드에서만)
> - 구현 순서 3번: planner가 분류 라벨을 읽고 TYPE RATING·CREW·WAKE·ROUTE 규칙을 적용. 이어서 HOLDING·PARKED 팀의 STAND 없는 FLIGHT와 CHECK 독립성(남은 일은 5장)
> - STAND 없는 출발과 도착(5.1.1)
> - OCC S1 `CLASSIFY` 초안(6장)
> - 팀 꾸리기(8.1)
> - LOGBOOK과 FLEET 카드의 TARGETS 실적(7.1, 7.2)
> - NETWORK(7.3)
> - DEPARTURE LOG(7.5)
> - TYPE RATING의 CHECKRIDE 추천(8.2)
> - 세션 조종: LAUNCH·STOP(8.5)
>
> 결정 사항은 맨 아래에 있다.

관련 문서: [occ.ko.md](occ.ko.md)(OCC가 분류 라벨과 tail 라벨을 SCHEDULE 작업으로 쓴다), [dispatch.ko.md](dispatch.ko.md)(이 라벨을 쓰는 planner).

## 1. 지금 사실

| 항목 | 지금 |
|---|---|
| 팀 | `vocado_nextjs`에서 오래 가는 세션 여섯 개 `TEAM_A` … `TEAM_F`. 각각 리더와 팀원이 있다 |
| CREW 규칙 | vocado `CLAUDE.md`: 팀원은 기본 `claude-opus-5-5`. `ui-builder`(Opus)는 UI를 만든다. `ui-qa`(Muse Spark 1.3)는 읽기 전용 화면·접근성 QA. `flash-helper`(DeepSeek V4.1 Flash)는 검색, 요약, 참고 자료 모으기, 정확히 지정된 기계적 수정을 한다. 구현, 리뷰 판정, 보안, DB, 인증, 권리, 이미지가 필요한 일은 하지 않는다 |
| 위험 작업 | DB, 마이그레이션, 보안, 권리 작업은 `Codex Engineering Task` 템플릿을 쓴다. DISPATCH는 CAUTION을 붙인다 |
| atc가 보는 팀 정보 | 세션 이름, 상태(AIRBORNE / HOLDING / PARKED), 점유한 워크트리, 지난 FLIGHT(팀 적합도) |
| 크기 | Linear 추정치 0건. planner는 WAKE 가중 AIRPORT 슬롯(L 0.5, M 1, H 2. 5장)을 센다. STAND 규칙으로 TEAM당 FLIGHT 1, 여기에 TEAM당 STAND 없는 FLIGHT 최대 1(5.1) |
| 미리 배정 | `tail:TEAM_X` 라벨: 그 팀에만 제안. `lane:TEAM_X`(PR #7)도 2026-10-10까지 별칭으로 읽는다(9장) |

예전 상태(FLIGHT마다 슬롯 1, `lane:`만)가 2026-09-26에 낳은 일:

- VOC-196(보안 정적 게이트)이 TEAM_D에, 그다음 TEAM_B에 제안됐다. 본문에는 "TEAM_E, on Opus"라고 적혀 있었다. atc에는 그것을 나타낼 방법이 없었다.
- 보안 티켓과 한 줄 문서 수정이 planner에게는 똑같아 보인다. 둘 다 슬롯 하나, 아무 팀.
- 4단계의 "정시(on-time)" 지표에 비교할 예상 소요 시간이 없다.

## 2. 용어

| 개념 | 용어 | 뜻 | 예 |
|---|---|---|---|
| 모든 팀 | **FLEET** | 운영자(사용자)가 굴리는 AIRCRAFT 전체 | TEAM_A … TEAM_F |
| 팀 식별 | **REGISTRATION** / **callsign** | REGISTRATION은 고정 이름(세션 이름), callsign은 부를 때 쓰는 이름 | `TEAM_B` / BRAVO |
| 팀 리더 | **CAPTAIN** | 그대로 | TEAM_B의 리더 세션 |
| 팀원 | **CREW** | CAPTAIN 아래 탄 모두. 각자 **POSITION**이 있다 | `backend` (Opus), `ui-builder`, `ui-qa`, `flash-helper` |
| 표준 팀 구성 | **CREW COMPLEMENT** | AIRCRAFT가 보통 함께 나는 CREW | CAPTAIN + backend (Opus) + Codex 리뷰 |
| 팀이 날 수 있는 일 | **TYPE RATING** | CREW가 자격을 가진 일의 종류 | `SEC`, `UI`, `DATA`, `DOCS` |
| FLIGHT를 팀에 미리 배정 | **TAIL ASSIGNMENT** | 항공편을 특정 기체에 묶는 항공사 스케줄링 용어. `lane:`을 대신한다 | Linear 라벨 `tail:TEAM_E` |
| 팀의 주 활동 영역 | **ROUTE** | 주로 나는 Linear 프로젝트 | TEAM_B → Beta Readiness |
| 팀의 목표 | **TARGETS** | SUPERVISOR가 AIRCRAFT마다 정하는 운항 목표 | 주당 FLIGHT 수, 정시율, 되돌린 작업 0 |
| 일의 종류 | **FLIGHT TYPE** | FLIGHT의 목적(4.1) | `BUILD`, `SURVEY`, `CHECK` |
| 일의 크기 | **WAKE CATEGORY** | 용량을 얼마나 차지하는지(4.2) | `L`, `M`, `H`, `J` |

TYPE RATING은 CREW의 것이고 FLIGHT TYPE은 FLIGHT의 것이다. 헷갈리지 않게 늘 전체 이름을 쓴다.

## 3. FLEET 등록부

AIRPORT 등록부(`airports.json`)처럼 `~/.local/state/atc/fleet.json`에 둔다. SUPERVISOR가 FLEET 탭에서 고치고, 파일이 없으면 atc는 기본값을 쓴다.

```json
{
  "defaults": {
    "complement": [
      { "position": "backend", "agent": "claude-opus-5-5" },
      { "position": "ui-builder", "agent": "ui-builder" },
      { "position": "ui-qa", "agent": "ui-qa", "limits": ["read-only"] },
      { "position": "flash-helper", "agent": "flash-helper", "limits": ["no BUILD", "no CHECK verdicts", "no SEC"] }
    ],
    "ratings": ["UI", "DATA", "DOCS"]
  },
  "aircraft": {
    "TEAM_B": { "base": "VCDO", "ratings": ["SEC", "DATA", "DOCS"], "routes": ["Beta Readiness"], "targets": { "flightsPerWeek": 3, "onTime": 0.8 } },
    "TEAM_E": { "base": "VCDO", "ratings": ["SEC", "DATA"], "routes": ["Beta Readiness"] },
    "TEAM_F": { "base": "VCDO", "ratings": ["UI", "DOCS"], "routes": ["Song Experience"] }
  }
}
```

- **CREW COMPLEMENT**는 감지하지 않고 선언한다. atc는 실제로 관찰한 CREW도 보여 준다(CAPTAIN 세션 아래 기록된 서브에이전트 호출, 8.3). FLEET 탭이 둘을 나란히 보여 주므로 어긋남이 보인다.
- **TYPE RATING**은 COMPLEMENT가 허용하는 것에서 시작한다. 도우미가 `flash-helper`뿐인 CREW는 `SEC`를 가질 수 없다. vocado가 보안 작업에 DeepSeek을 금지하기 때문이다.
- **ROUTES**와 **TARGETS**는 SUPERVISOR가 정한다. OCC는 변경 초안을 쓸 수 있지만(4단계) 적용하지는 않는다.

## 4. FLIGHT 분류

축은 셋이고 서로 독립이다. 각각 OCC가 맡는 Linear 라벨이다(occ.ko.md 4장의 계획 필드).

### 4.1 FLIGHT TYPE: 어떤 일인가

| FLIGHT TYPE | 항공에서의 뜻 | 일 | STAND 필요 | 날 수 있는 CREW | 예 |
|---|---|---|---|---|---|
| `BUILD` | Scheduled revenue flight(정기 운항편) | 변경을 구현하고 PR을 연다 | 예 | Opus / `ui-builder`. `flash-helper`는 절대 안 됨 | VOC-193 caller checks |
| `MAINT` | Maintenance check(정비 점검) | 리팩터링, 정리, 인프라, CI, 테스트. 제품 동작은 바꾸지 않음 | 예 | Opus | VOC-195 lock race 수정 |
| `TEST` | Test flight(시험 비행) | 버릴 수도 있는 스파이크나 프로토타입 | 대개 | Opus | 새 replay 구조를 scratch 브랜치에서 시험 |
| `SURVEY` | Survey flight(측량 비행) | 조사, 감사, 목록 작성. 결과는 문서나 발견 사항이고 코드는 없음 | 아니요 | Opus. 보안이 아닌 검색·요약은 `flash-helper` | Linear 사용 조사, Mobbin 참고 자료 |
| `CHECK` | Check ride(자격 심사 비행) | PR 리뷰나 주장 검증. 결과는 판정 | 아니요 | Opus(CAPTAIN이나 독립 세션). `flash-helper`는 절대 안 됨 | PR #400의 exact-head 리뷰 |
| `FERRY` | Ferry flight(승객 없이 기체만 옮기는 비행) | 설계 판단 없는 기계적 이동: 의존성 올리기, 이름 바꾸기, 5줄 이하 문서 수정 | 가끔 | 누구나. 정확히 지정된 수정이면 `flash-helper`도 | VOC-56 종료 증거, 오타 수정 |

바뀌는 것:

- `SURVEY`와 `CHECK`는 워크트리가 필요 없다. 그래서 TEAM당 FLIGHT 1이라는 STAND 규칙에 세지 않는다. HOLDING·PARKED 팀이 AIRCRAFT당 하나 받을 수 있다(5.1).
- `CHECK`는 그것이 검토하는 BUILD를 날았던 팀에 주지 않는다(독립성. TOWER가 자기 배정을 심판하지 않는 것과 같다. 5.2).
- `FERRY` FLIGHT는 묶을 수 있다. CAPTAIN 한 명이 한 번에 여러 개를 맡는다.

### 4.2 WAKE CATEGORY: 얼마나 큰가

항공기는 wake turbulence(후류) 등급으로 나뉜다. 무거운 기체일수록 간격과 활주로 시간이 더 필요하다. FLIGHT의 WAKE CATEGORY는 그 FLIGHT가 용량을 얼마나 차지하는지 말한다.

| WAKE | 크기 | 대략의 모양 | 예상 block time | 차지하는 AIRBORNE 슬롯 |
|---|---|---|---|---|
| `L` Light | 작음 | 파일 하나나 몇 줄, 새 테스트 불필요 | < 1시간 | 0.5 |
| `M` Medium | 보통 | 테스트를 갖춘 기능·수정 하나, PR 하나 | 몇 시간 | 1 |
| `H` Heavy | 큼 | 여러 모듈·서비스, 마이그레이션이나 보안 영역, 리뷰 여러 차례 예상 | 1–2일 | 2 |
| `J` Super | 매우 큼 | 팀이나 AIRPORT를 넘나듦, 설계가 먼저 필요, 나눌 가능성이 큼 | 며칠 | 배정 불가. 나눠야 한다(SCHEDULE `SPLIT`). 아니면 상위 이슈가 된다 |

바뀌는 것:

- **슬롯**: AIRPORT 용량을 WAKE 가중 슬롯으로 센다. 예를 들어 VCDO의 4는 `H` 둘이나 `M` 넷이다.
- **Separation**(간격): `related`로 묶였거나 같은 영역을 건드리는 `H` FLIGHT 둘은 `L` 둘보다 충돌 감점이 크다.
- **정시**: 실제 이력이 대신할 때까지 예상 block time이 4단계 정시 지표의 기준이다. 분류마다 LOGBOOK 항목이 20건쯤 쌓이면 그 중앙값이 대신할 예정이다. 아직 만들지 않음(7.2).
- **`J`**는 날라는 신호가 아니라 계획하라는 신호다.

### 4.3 필요한 TYPE RATING: 무엇을 건드리나

| Rating | 범위 | 규칙 |
|---|---|---|
| `SEC` | DB, 마이그레이션, RLS, 인증, 권한, 보안, 권리, 배포, 결제(`Codex Engineering Task` 범위) | `SEC`를 가진 AIRCRAFT만. 늘 CAUTION. 어느 단계에서도 자동 배정하지 않음 |
| `UI` | 화면, 컴포넌트, 시각 디자인, 접근성 | COMPLEMENT에 `ui-builder`와 `ui-qa`가 있는 AIRCRAFT를 우선 |
| `DATA` | 언어 데이터, 파이프라인, 콘텐츠, 분석 | — |
| `DOCS` | 문서, 규칙 파일, 인수인계 노트 | — |

FLIGHT 하나가 여러 rating을 요구할 수 있다(`SEC` + `DATA`). AIRCRAFT는 그 전부를 가져야 한다.

### 4.4 라벨

| 축 | Linear 라벨 | 없을 때 기본값 |
|---|---|---|
| TAIL ASSIGNMENT | `tail:TEAM_E` | 아무 팀 |
| FLIGHT TYPE | `type:BUILD` … `type:FERRY` | `BUILD` |
| WAKE CATEGORY | `wake:L` … `wake:J` | `M` |
| 필요한 TYPE RATING | `rating:SEC`, `rating:UI`, …, 또는 vocado의 기존 **Risk** 그룹(Security, Migration, Rights, Contract)에 든 라벨 → `SEC` | 없음. DISPATCH의 CAUTION만으로는 `SEC`가 붙지 않는다. OCC가 `CLASSIFY` 작업으로 `rating:SEC` 라벨로 바꾼다(6장) |

Linear 추정치가 아니라 라벨을 쓴다. 추정치는 팀 설정당 숫자 하나인데, 축 넷에는 필드 넷이 필요하다. 라벨은 Linear에서 보이고 거르기 쉽다. Linear 기본 보고가 필요해지면 나중에 추정치가 WAKE를 따라가게 할 수 있다.

**라벨 그룹.**

- atc는 Linear 라벨 그룹 안의 라벨을 `group:name`으로 읽는다. Risk 그룹의 "Security"는 `Risk:Security`로 들어온다.
- 그래서 각 축은 평면 라벨(`type:BUILD`)로도, 자식 `BUILD` … `FERRY`를 가진 `type`이라는 Linear 라벨 그룹으로도 쓸 수 있다.
- `type`, `wake`, `tail`은 그룹을 권한다. Linear의 단일 선택 그룹은 이슈당 값을 하나만 허용하기 때문이다.
- 예전의 단독 라벨 `Risk: Security` 등도 같은 방식으로 읽는다.
- vocado의 `Area` 그룹(Database, Backend, Web, RN)은 아직 rating에 쓰지 않는다.

## 5. Planner 규칙

이 순서로 적용한다. 처음 넷은 강한 규칙(hard rule)이다. 5번의 `J` 제외도 그렇다. 이를 통과하지 못한 FLIGHT는 사유와 함께 제외되고, 다른 팀에 주지 않는다.

1. **TAIL ASSIGNMENT**: `tail:TEAM_X` → 그 AIRCRAFT에만(지금 `lane:`이 하는 일).
2. **TYPE RATING**: AIRCRAFT가 필요한 rating을 모두 가진다.
3. **FLIGHT TYPE 대 CREW**: COMPLEMENT가 그 일을 날 수 있다. `BUILD`, `MAINT`, `TEST`는 `flash-helper`가 아니고 `no BUILD`나 `read-only` 제한이 없는 팀원이 필요하다. `CHECK`는 `no CHECK verdicts`나 `read-only`가 없는 팀원이 필요하다. `SURVEY`와 `FERRY`는 어느 CREW든 된다.
4. **CHECK 독립성**: `CHECK`는 그것이 검토하는 것을 만든 AIRCRAFT에 가지 않는다(5.2).
5. **WAKE 슬롯**: AIRPORT에 가중 용량이 충분히 남아 있다(L 0.5, M 1, H 2). AIRBORNE 팀은 쥐고 있는 FLIGHT 중 가장 큰 WAKE로 세고, 모르면 1로 센다. `J`는 제외("나눠야 함"). STAND 없는 FLIGHT도 슬롯을 차지한다.
6. **STAND**: STAND 규칙, 그다음 그 규칙 밖의 STAND 없는 FLIGHT(5.1).
7. **점수**(soft): 지금과 같고, 여기에 **ROUTE**(+1, `dispatch.json`의 가중치 `route`. FLIGHT의 프로젝트가 AIRCRAFT의 routes에 있을 때)를 더한다. 쉬는 AIRCRAFT에 주는 가산점은 없다.

살아 있는 AIRCRAFT 중 누구도 자격을 가질 수 없으면 FLIGHT는 그 사유로 제외된다(아무도 그 rating이 없음, 그 종류를 날 CREW가 없음, CHECK를 날 수 있는 것이 만든 팀뿐). 자격 있는 AIRCRAFT가 있지만 바쁘면 전처럼 그냥 기다린다.

DISPATCH 카드는 제목 아래 분류를 보여 준다. 예: `BUILD · H · SEC · tail:TEAM_E`. `type:`이나 `wake:` 라벨이 없으면 "(기본값)"과 함께 흐리게 보인다.

### 5.1 STAND 규칙과 STAND 없는 FLIGHT

`SURVEY`와 `CHECK`는 워크트리가 필요 없다(`server/crew.ts`의 `needsStand`). `FERRY`는 "가끔" 필요하므로(4.1) planner는 STAND가 필요한 것으로 본다. `type:` 라벨이 없는 FLIGHT는 `BUILD`이고 STAND가 필요하다.

계획은 같은 후보 FLIGHT를 두 번 훑어서 만든다.

1. **STAND 규칙**(그대로): PARKED이거나 끝난 FLIGHT의 STAND만 쥔 HOLDING이고, 진행 중인 STAND 필요 제안이 없는 AIRCRAFT는 FLIGHT를 최대 하나 받는다. STAND 없는 FLIGHT도 전처럼 여기에 낀다.
2. **STAND 없는 FLIGHT 훑기**: 남은 STAND 없는 FLIGHT를 STAND 규칙 밖에서 다시 짝짓는다.

| | 규칙 |
|---|---|
| 받을 수 있는 AIRCRAFT | **HOLDING**(쉬는 중, 끝나지 않은 FLIGHT의 STAND를 쥠)과 **PARKED**. 둘 다인 이유: 4.1에서 HOLDING 팀이 하나 받을 수 있다고 했고, 진행 중인 BUILD 제안(승인·전송·수락됐지만 아직 DEPARTED 아님)이 있는 PARKED 팀도 같은 이유로 하나 받을 수 있다 |
| 받을 수 없음 | **AIRBORNE**(세션이 바쁨): CAPTAIN이 턴 중이라 FLIGHT PLAN이 그 뒤에 줄을 선다. 팀은 턴 사이에 HOLDING으로 돌아오고 planner는 5분마다 돌므로 그때 잡힌다. AOG, RETIRED, 기지 AIRPORT 없음, 다른 AIRPORT도 받지 않는다 |
| 한도 | AIRCRAFT당 STAND 없는 FLIGHT 1건. 진행 중인 제안까지 센다(`reservedOf`의 `Reserved.aircraftFlights`). 두 번 훑기를 통틀어 한 계획에서 AIRCRAFT당 제안 1건이므로, PARKED 팀이 한 계획에서 BUILD와 SURVEY를 함께 받지 않는다 |
| 열린 제안 | 따로 세지 않는다. 판정 전 제안은 이전 계획의 짝이다. 새 계획이 더는 만들지 않는 짝은 `syncOps`가 SUPERSEDED로 닫으므로, 같은 AIRCRAFT가 둘을 모을 수 없다 |
| 예약은 나뉜다 | 진행 중인 STAND 없는 제안은 STAND 규칙을 막지 않는다(SURVEY 중인 팀도 BUILD를 받을 수 있다). 진행 중인 BUILD 제안도 STAND 없는 FLIGHT를 막지 않는다. `AircraftState.reserved`는 STAND가 필요한 예약, `reservedLight`는 STAND 없는 예약이다. 스냅숏이 더는 모르는 예약 FLIGHT는 STAND가 필요한 것으로 센다 |
| 같은 규칙 | TAIL ASSIGNMENT(HOLDING인 tail 팀도 STAND 없는 FLIGHT를 받을 수 있음), TYPE RATING, CREW, CHECK 독립성, WAKE 슬롯 |
| 순서 | STAND 규칙이 먼저라 BUILD 작업이 자리를 지킨다. STAND 없는 FLIGHT는 남은 자리를 채운다. 이 훑기 안에서는 점수 순 |
| 표시 | 0점 요소 `STAND 없이`와 AIRCRAFT 상태: `HOLDING — VOC-10 진행 중 — SURVEY는 STAND가 필요 없어 STAND 규칙 밖(AIRCRAFT당 1건)` |
| 승인 운용 | 승인된 STAND 없는 제안은 AIRCRAFT가 HOLDING인 동안 유효하다(`canTakeNow`). `syncOps`도 SUPERSEDED 사유에 같은 규칙을 쓴다. 출발과 도착은 5.1.1 |

라벨이 붙은 FLIGHT만 이 길로 간다. SCHEDULE `classify` 후보는 조사, 리뷰, 비교, 계획처럼 보이는 제목을 앞에 둔다(`server/schedule.ts`의 `standFreeHint`). 그래서 OCC가 `SURVEY`·`CHECK`일 것 같은 FLIGHT를 더 빨리 분류한다. 순서는 힌트일 뿐이고, 라벨은 여전히 OCC가 정한다.

#### 5.1.1 STAND 없는 출발과 도착

STAND가 필요한 FLIGHT는 STAND가 생기면 DEPARTED, PR이 머지되면(LOGBOOK) ARRIVED다. STAND 없는 FLIGHT에는 두 신호가 모두 없다. 그래서 승인 운용(2b)에서 atc는 대신 READBACK과 CAPTAIN의 보고를 쓴다(2026-09-27 구현).

```
CAPTAIN: "READBACK D-0012"  → OCC: atcctl dispatch readback D-0012
                            → atc: ACCEPTED and DEPARTED at the same moment (departedStand null, departedVia "readback")
CAPTAIN: "done: <link>"     → OCC: atcctl dispatch arrived D-0012 -- '<result link or one line>'
                            → atc: ARRIVED (arrivedNote, arrivedUrl)
```

| 항목 | 규칙 |
|---|---|
| 어떤 FLIGHT | READBACK 때 FLIGHT 라벨로 본 `needsStand`가 false인 것(`type:SURVEY`, `type:CHECK`). 모르는 FLIGHT는 STAND가 필요한 것으로 센다. `accepted`로 남은 STAND 없는 제안(예전 기록이거나, FLIGHT가 스냅숏에 없던 경우)은 다음 동기화에 DEPARTED한다 |
| 예약 | STAND 없는 `departed` 제안은 ARRIVED나 RECALLED까지 `inFlight`에 남아 AIRCRAFT(`reservedLight`)와 FLIGHT를 잡아 둔다. Linear가 뭐라 하든 만료되지도, SUPERSEDED되지도 않는다. 보고 없이 24시간이 지나면 `overdue`에 보인다 |
| ARRIVED 뒤 | 예약이 풀린다. 7일 동안 planner는 그 FLIGHT를 `이미 완료됨 — D-0012 ARRIVED(CAPTAIN 보고)`로 뺀다. LOGBOOK에 아무것도 오르지 않고 Linear는 아직 Todo일 수 있기 때문이다. 그 뒤에는 Linear를 따른다 |
| RECALL | STAND 없는 `departed` 제안도 `sent`·`accepted`처럼 RECALL할 수 있다. RECALL 문구는 "STAND를 그대로 두라" 대신 중간 결과를 달라고 한다. STAND가 필요한 DEPARTED는 여전히 RECALL하지 않는다. RECALLED는 다른 RECALL처럼 예약을 푼다 |
| gate3 | STAND 없는 READBACK은 READBACK 비율에는 넣고 DEPARTED 비율에는 넣지 않는다(넣으면 비율이 부풀기 때문). `gate3.standFree`가 그 READBACK·ARRIVED 수를 보인다 |
| ATFM A8 | ARRIVED하지 않은 STAND 없는 FLIGHT를 날고 있는 AIRCRAFT는 세션이 쉬고 있어도 자동 대상이 아니다 |

**감지가 아니라 보고인 이유.** 자동 ARRIVED도 검토했다. CHECK라면 대상 PR의 리뷰, SURVEY라면 문서 PR이나 이슈 댓글로 판단하는 방식이다. 하지만 종류별 추정 규칙(어느 리뷰인지, 누구의 댓글인지)이 필요하고, 잘못 맞추면 AIRCRAFT를 일찍 풀어 버린다. CAPTAIN은 이미 OCC에 결과를 보고하므로 첫 단계는 보고다. 감지는 나중에 OCC가 확인하는 제안으로 더할 수 있다.

### 5.2 CHECK 독립성

`server/dispatch.ts`의 순수 함수로, 두 번 훑기 모두에서 모든 `CHECK`에 적용한다.

**무엇을 검토하나**(`checkTargetOf`): Linear 관계(`blockedBy`, `related`, `blocks`, `parent`)에 있는 FLIGHT, 그리고 제목에 있는 FLIGHT key와 PR 번호(`VOC-205`, `PR #400`, `#400`, `…/pull/400`). 스냅숏에는 이슈 본문이 없어서 본문은 읽지 않는다.

**누가 만들었나**(`checkBuildersOf`): 답을 주는 출처를 모두 쓴다.

| 출처 | 맞추는 법 |
|---|---|
| LOGBOOK | `flight`가 대상이거나, PR 번호가 CHECK의 AIRPORT에서 대상인 항목 → `aircraft` |
| 열린 PR | 번호가 AIRPORT 저장소에서 대상이거나, ticket key가 대상인 PR → 그 `standPath`를 점유한 TEAM 세션. 번호로 찾은 PR은 그 ticket key를 대상에 더한다 |
| STAND | ticket key가 대상인 워크트리 → 그것을 점유한 TEAM 세션(HANDOFF된 점유 포함) |
| 점유 이력 | 점유 기록에 대상 FLIGHT가 적힌 세션(`readFlightHistory`) |

세션 이름은 LOGBOOK처럼 `teamPattern`에 맞춰 보고 대문자로 바꾼다. 찾은 만든 팀은 모두 뺀다(HANDOFF 뒤에는 두 AIRCRAFT 모두). 만든 팀만 그 CHECK를 날 수 있으면 제외된다: `CHECK 독립성 — 검토 대상을 만든 TEAM_D 말고 이 CHECK를 날 AIRCRAFT 없음 (…)`.

**만든 팀을 모를 때**(대상이 없거나, 어느 출처도 이름을 대지 않을 때)는 CHECK를 막지 않는다. 카드에 0점 요소 `CHECK 독립성`이 `확인 못 함 — …`으로 붙어, SUPERVISOR가 손으로 확인한다. 알 때는 이 요소가 빼 둔 만든 팀을 적는다.

아직 만들지 않은 것:

- WAKE 크기를 반영한 충돌 위험(같은 영역 접근 방식은 [issue #41](https://github.com/chaehy5665/atc/issues/41)에 스케치)
- STAND 없는 FLIGHT의 자동 ARRIVED 감지(5.1.1)
- STAND 없는 FLIGHT의 LOGBOOK 항목(STAND 없는 ARRIVED는 TARGETS에 세지 않는다)

ATFM의 자동 대상 판정(A8)은 여전히 배정 가능한 AIRCRAFT를 요구한다. 그래서 HOLDING 팀에 간 STAND 없는 제안은 자동 대상이 되지 않는다(어차피 A3가 SURVEY와 CHECK를 뺀다).

## 6. 누가 분류하나

| 단계 | 라벨을 쓰는 쪽 |
|---|---|
| 손으로(어느 단계든) | SUPERVISOR나 President. 아직 만들지 않음: 본문을 보고 분류를 제안하는 DISPATCH 메모 |
| OCC S1(만듦) | OCC가 `type:`이나 `wake:` 라벨이 없는 Todo·Backlog FLIGHT마다 SCHEDULE `CLASSIFY` 작업 초안을 쓴다(`server/schedule.ts`의 `candidatesOf`. `SURVEY`·`CHECK`일 것 같은 것이 먼저): FLIGHT TYPE, WAKE, rating과 한 줄 이유. SUPERVISOR가 그림자 판정을 표시한다 |
| OCC S2(만듦, 기본은 꺼짐) | SCHEDULE `mode`가 `approval`일 때, 승인된 `CLASSIFY` 작업을 linear-guard를 거쳐 쓴다(occ.ko.md) |
| OCC S3(아직 만들지 않음) | S2 일치율이 높으면 `SEC`가 아닌 FLIGHT의 `CLASSIFY`는 자동이 될 수 있다. `rating:SEC`를 붙이거나 떼는 것은 늘 승인이 필요하다 |

분류는 정해진 선택지 중에서 고르는 일이다. 그래서 typed-judgment 모델(DISPATCH 노트의 Jev 평가)의 첫 후보이기도 하다. SUPERVISOR의 그림자 판정과 비교해 잰다.

### 6.1 판정 계열(Jev)

상태: 만들었고 **기본은 꺼짐**(ATC-36). 판정 계열은 SCHEDULE `CLASSIFY` 초안에 표시만 남긴다. 판정하지 않는다.

**판정 방법**(`server/judges/`). CLASSIFY 인터페이스 하나로 묻는다: FLIGHT TYPE Choice(4.1의 여섯 가지, CHECK → SURVEY → TEST → FERRY → MAINT → BUILD 순서), WAKE Choice(4.2), TYPE RATING마다 Noul(4.3, yes 확률 0.5 이상이면 붙임). atc는 그 분류를 OCC 초안이 적은 축과 비교한다. 같으면 `agree`, 다르면 `disagree`이고, `TYPE MAINT(80%) ≠ 초안 BUILD` 같은 이유가 붙는다. RATING은 rating마다 "초안이 붙이거나 FLIGHT에 이미 라벨이 있음"과 비교한다. 엔진은 둘이다.

| 엔진 | 무엇 |
|---|---|
| `stub` | 녹화한 응답, 네트워크 없음. 테스트와 `ATC_JUDGE_ENGINE=stub`으로 띄운 시험 서버가 쓴다 |
| `jev` | TypeSafe System One: `POST https://api.typesafe.ai/v1/systemone`, 모델 `jev-latest`, `Authorization: Bearer $TYPESAFE_API_KEY`(`.env.local`. 로그·출력·기록에 쓰지 않는다) |

**스위치**는 `~/.local/state/atc/judges.json`의 `judges.jev`다: `off`(기본), `replay`, `shadow`. SUPERVISOR만 바꾼다. 설정 창 → AGENTS → JUDGES에서 바꾸거나, 이 화면 Origin으로 `PUT /api/settings {judgesJev}`를 보낸다(AUTOLAND와 같다). atcctl에는 명령이 없어 관제 세션은 바꿀 수 없다. 값이 없거나 모르는 값이면 `off`로 읽는다.

| 모드 | 판정하는 것 |
|---|---|
| `off` | 아무것도 읽거나 보내지 않는다 |
| `replay` | SUPERVISOR가 판정한 CLASSIFY 초안 가운데 이 계열의 mark가 없는 것, 오래된 것부터. 본문은 지금 읽은 것이라 초안을 쓸 때와 다를 수 있다 |
| `shadow` | mark가 없는 열린 CLASSIFY 초안 |

서버는 1분에 3건까지만 돌린다. 오류가 난 초안은 한 시간 뒤에 다시 하고, 401·429가 나면 그 바퀴를 멈춘다. 마지막 실행과 오류는 설정 창에 보인다.

**반출 규칙.** 스위치를 `replay`나 `shadow`로 켜는 것이 SUPERVISOR의 데이터 반출 결정이다. 나가는 것은 허용 목록뿐이다: 제목과 본문의 세 칸(목표, 수정 허용 범위, 완료 기준), 칸마다 600자까지. FLIGHT key, 라벨, 댓글, 담당, 프로젝트, 다른 칸은 보내지 않는다. `rating:SEC`·`Risk:*` 라벨이 있는 FLIGHT, 라벨을 모르는 FLIGHT, `rating:SEC`를 붙이는 초안은 **제목만** 보내고 본문은 읽지도 않는다. mark마다 보낸 칸(`sent`)과 본문을 뺀 까닭(`withheld`)이 남는다.

**기록.** `~/.local/state/atc/judges.jsonl`에 추가만 한다. 초안·계열마다 `judge` 줄(분류, 확률, 판정, 엔진, 모델, run)이 쌓이고, 스위치를 바꿀 때마다 `mode` 줄이 붙는다. `schedule.jsonl`과 CROSSCHECK 한 칸은 건드리지 않는다.

**쏠림 없이 재기.** mark는 SUPERVISOR가 판정한 초안에만 보인다. RECENT에 `JEV agree` 같은 칩으로 보이고, 툴팁에 분류와 보낸 범위가 있다. 열린 초안의 mark는 세기만 하고 숨긴다. 점검 패널의 `JEV 일치 m/n` 줄은 계열마다 사람 판정에 대해 `crosscheckRateOf`로 잰 값이고, `replay` mark도 센다(판정 계열의 입력에는 판정이 들어가지 않는다). ATFM 자동 판정은 뺀다. mark는 초안 상태를 바꾸지 않고, 20건·80% 게이트에도 들지 않는다.

아직 만들지 않음: DISPATCH 판정 계열, 다른 계열, 판정 계열 일치율을 S3에 쓰는 것.

## 7. TARGETS

AIRCRAFT마다 SUPERVISOR가 FLEET 탭에서 정한다. 보여 주기만 하고 점수에 넣지 않는다. atc는 이것으로 AIRCRAFT 순위를 매기지 않고, planner도 읽지 않는다.

| 목표 | 재는 곳 |
|---|---|
| 주당 FLIGHT | 이번 주(월요일 00:00 로컬 시각부터 지금까지) ARRIVED한 LOGBOOK 항목 |
| 정시율 | 최근 14일 LOGBOOK 항목에서 팀 block time(시작부터 PR 열기까지)이 7.2의 예상 안에 든 비율. 리뷰·머지 대기는 착륙 대기(landing wait)로 따로 보인다 |
| 되돌린 작업 | 최근 14일 LOGBOOK 항목 중 `reverted`로 표시된 것(`Revert "…"` PR이 머지됨). 다시 열린 FLIGHT는 아직 세지 않는다 |
| 충돌 | FLIGHT를 나는 동안 그 STAND에서 난 LOS. 최근 14일 LOGBOOK 항목을 합한다 |

4단계(네트워크 계획)는 이것을 프로젝트 목표 옆에 둔다(7.3). OCC가 목표·ROUTE 변경 초안을 그림자 운용으로 쓰고(7.4, S1 만듦), 결정은 SUPERVISOR가 한다.

### 7.1 LOGBOOK

항공기 logbook은 기체가 날았던 모든 비행을 적는다. atc의 LOGBOOK도 AIRCRAFT마다 같은 일을 한다. AIRPORT의 기본 브랜치에 머지된 PR마다 한 줄이다. 그때 그 FLIGHT(또는 AD HOC 작업)가 ARRIVED한다. PR 여러 개로 난 FLIGHT는 줄도 여러 개다. `Revert` PR은 따로 줄을 만들지 않는다.

다른 기록처럼 `~/.local/state/atc/logbook.jsonl`에 추가만 하며 둔다. 작업은 둘이다.

```json
{"op":"arrived","t":"…","key":"owner/repo#31","aircraft":"TEAM_J","flight":"VOC-201","class":{"type":"BUILD","wake":"M","ratings":["UI"],"explicit":{"type":true,"wake":true}},"airport":"ATCC","pr":{"repo":"owner/repo","number":31,"url":"…","title":"…"},"branch":"claude/logbook","stands":["/home/…/worktrees/atc-logbook"],"departedAt":"…","departedFrom":"claim","arrivedAt":"…","blockMin":190,"landingWaitMin":122,"codexFindings":1,"changesRequested":false,"reverted":false,"los":0}
{"op":"reverted","t":"…","key":"owner/repo#31","by":{"number":35,"url":"…"}}
```

| 필드 | 뜻 |
|---|---|
| `key` | `owner/repo#number`, 중복을 막는 key. PR 하나는 한 번만 적는다 |
| `aircraft` | 그 FLIGHT를 난 팀 세션의 REGISTRATION(아래), 대문자. atc가 알 수 없으면 `null`이고, 그래도 줄은 적는다 |
| `flight` | PR 브랜치(`voc-<n>`)나 제목 끝 `(VOC-n)`에서 얻은 ticket key. AD HOC 작업은 `null` |
| `class` | 도착 시점 그 FLIGHT의 Linear 라벨로 본 `classOf(labels)`(FLIGHT TYPE, WAKE, rating, 그리고 type·wake가 라벨에서 왔는지). AD HOC이거나 Linear가 티켓을 모르면 `null` |
| `airport` | 저장소의 AIRPORT code |
| `pr` | `{repo, number, url, title}` |
| `stands` | FLIGHT를 날았던 STAND(워크트리 경로) |
| `departedAt` | 그 STAND들의 점유 `since`(`departedFrom: "claim"`)와 처음 맞는 DEPARTURE LOG 줄(`"departure"`, 7.5) 중 이른 것. 머지 뒤의 것은 무시한다. 둘 다 없거나 PR이 더 일찍 열렸으면 PR의 `createdAt`(`departedFrom: "pr"`). 점유는 3시간 쉬면 `since`를 다시 시작하므로 PR이 더 이른 신호일 수 있다 |
| `branch` | PR의 head 브랜치. DEPARTURE LOG와 맞출 때 쓴다. 2026-09-27 전에 쓴 줄에는 없다 |
| `arrivedAt` | PR의 `mergedAt` |
| `blockMin` | 팀 block time: PR `createdAt − departedAt`, 분 단위 정수(벽시계 기준, 밤 포함). `departedFrom`이 `"pr"`이면 `null`. PR을 열기 전 점유가 없으면 atc는 팀이 언제 시작했는지 모른다(계산되는 0은 실제 소요 시간이 아니다) |
| `landingWaitMin` | 착륙 대기: `arrivedAt − ` PR `createdAt`, 분 단위 정수. SUPERVISOR의 리뷰·머지에 든 시간이다. 정시율에 들지 않는다 |
| `codexFindings` | PR의 모든 커밋에 걸친 Codex `COMMENTED` 리뷰 수, 곧 Codex가 무언가를 찾은 리뷰 차례 수. head만 세지 않는다. 머지할 즈음엔 head의 지적이 대개 해결돼 있어서 head만 세면 거의 늘 0이 된다 |
| `changesRequested` | 누군가 한 번이라도 `CHANGES_REQUESTED` 리뷰를 남김 |
| `reverted` | 나중의 `reverted` 줄로 켜진다 |
| `los` | `departedAt`과 `arrivedAt` 사이에 그 STAND들에서 FLIGHT RECORDER에 난 `alert.raised` LOSS OF SEPARATION 이벤트 수 |

**어느 STAND인가.** 아래 순서로 보고, 처음 무언가를 주는 것을 쓴다.

1. FLIGHT RECORDER(30일)에서 그 PR의 `landing.*` 이벤트의 `workspacePath`
2. 아직 PR 브랜치가 체크아웃된 워크트리
3. 이름에 FLIGHT의 ticket key가 든 워크트리(`readFlightHistory`와 같은 규칙)
4. 마지막으로 DEPARTURE LOG에 그 브랜치로 적힌 STAND(그때쯤 워크트리가 없어졌을 수 있다)

**어느 AIRCRAFT인가.** 그 STAND들을 점유한 세션 중 이름이 팀 패턴(`TEAM_X`)에 맞는 것만 본다. 여럿이면 마지막 점유 활동이 가장 늦은 세션이다. HANDOFF 뒤에는 착륙시킨 AIRCRAFT가 항목을 받는다. 세션 이름은 세션 등록부에서 오므로, 파일이 없어진 세션은 알 수 없다. 남은 점유가 없으면 머지 전 DEPARTURE LOG에서 그 브랜치(없으면 그 FLIGHT나 STAND)의 마지막 AIRCRAFT를 쓴다(7.5). 그것도 없으면 `null`.

**ARRIVED를 찾는 법.** 열린 PR 읽기는 그대로 둔다. 가벼운 두 번째 읽기가 10분마다 돈다. GitHub remote가 있는 AIRPORT마다 `gh pr list --state merged --limit 30`을 돌려 저장소 기본 브랜치로 들어간 PR만 남긴다. 이미 LOGBOOK에 있는 PR은 건너뛴다. 그래서 재시작 뒤 첫 실행은 최근 머지된 PR 30개를 채워 넣기도 한다(점유가 없어진 것은 `aircraft: null`).

**Revert.** 제목이 `Revert "…"`인 머지된 PR은 따로 FLIGHT가 아니다. 되돌린 PR에 `reverted` 줄을 더한다. 대상은 본문의 `Reverts owner/repo#N`으로 찾고, 없으면 같은 저장소에서 따옴표 안 제목으로 찾는다. LOGBOOK에 없는 PR의 revert는 무시한다.

**나중에 채우기.** 세 번째 작업은 AIRCRAFT를 몰랐던 줄을 파일을 다시 쓰지 않고 채운다.

```json
{"op":"attributed","t":"…","key":"owner/repo#32","aircraft":"TEAM_J","via":"departures","departedAt":"…","blockMin":30}
```

LOGBOOK은 돌 때마다 읽은 저장소의 `aircraft: null` 줄을 모두 DEPARTURE LOG에서 찾는다(브랜치로, 없으면 FLIGHT나 STAND로, 머지 전 것만).

- 맞으면 `attributed` 줄을 하나 쓴다. 그 줄에 출발이 없었고(`departedFrom: "pr"`) DEPARTURE LOG가 PR보다 이르면 `departedAt`과 `blockMin`도 싣는다.
- 접을 때(fold)는 아직 `null`인 줄에만 적용한다(항목에 `attributedBy: "departures"`가 보인다). 그래서 이미 아는 AIRCRAFT를 덮어쓰지 않고, 두 번 쓰지도 않는다.
- DEPARTURE LOG가 생기기 전의 줄은 대부분 `null`로 남는다. 예상한 일이다.

**지시서 재기**(ATC-32). 네 번째 작업 `measured`는 최근 30일 ARRIVED FLIGHT마다 DIRECT·VECTORS 중 어느 지시서로 받았는지, SOLO·CREW 중 어떻게 날았는지, 중간 질문과 READBACK 시각, PR 뒤 수정 커밋, P0–P2 지적을 적는다. 빈 칸만 채운다. 칸, 출처, VECTORS · DIRECT 비교는 [dispatch.ko.md](dispatch.ko.md) "DIRECT briefs"에 있다. `GET /api/logbook/briefs?days=30`이 비교를 돌려준다.

**API.** `GET /api/logbook?aircraft=TEAM_X&days=14`는 접은 항목을 최근 도착 순으로 돌려준다. `aircraft`는 선택(대소문자 무시), `days`는 기본 14, 최대 90.

### 7.2 FLEET 카드의 실적

`fleetView`는 AIRCRAFT마다 LOGBOOK으로 계산한 `actuals`를 더한다.

| 실적 | 규칙 |
|---|---|
| 이번 주 | 월요일 00:00(서버 로컬 시각)부터 ARRIVED한 항목. `flightsPerWeek`와 함께 보인다: "이번 주 2/3" |
| 정시 | 최근 14일 항목 중 예상과 `blockMin`이 모두 있는 것에서 `blockMin`이 예상 안에 든 비율. `onTime`과 함께 보인다. `blockMin: null`인 항목은 정시로 세지 않고 뺀다 |
| 착륙 대기 | 최근 14일 항목의 `landingWaitMin` 중앙값(PR 시각은 늘 알므로 전부): "착륙 대기 중앙값 5h" |
| 되돌림 | 최근 14일 항목 중 `reverted`로 표시된 것 |
| LOS | 최근 14일 항목의 `los` 합 |
| 최근 | 마지막 5개 항목: 팀 block time(또는 `—`), `+` 착륙 대기, ON TIME / DELAYED |

**예상.**

- WAKE가 라벨에서 온 FLIGHT는 4.2의 block time을 상한으로 읽어 쓴다: `L` 60분, `M` 240분("몇 시간"을 4시간으로), `H` 2880분(2일).
- `J`, 라벨 없는 WAKE, AD HOC 작업에는 정해진 예상이 없다. 같은 FLIGHT TYPE·WAKE의 다른 LOGBOOK 항목(AD HOC은 따로 한 묶음)의 `blockMin` 중앙값과 비교한다. 그런 항목이 3건 이상일 때만 그렇다.
- 중앙값에는 AIRCRAFT와 `blockMin`을 아는 항목만 넣는다.
- 예상을 정할 수 없으면 그 항목은 정시율에 세지 않는다.
- 분류가 20건쯤 되면 그 중앙값이 정해진 숫자를 대신할 수 있다(4.2). 이 전환은 아직 만들지 않았다.

### 7.3 NETWORK (4단계, 읽기 전용)

4단계는 TARGETS를 프로젝트 목표 옆에 두어 읽기 전용 화면 하나로 보인다. `GET /api/network`(`server/network.ts`)이고, NETWORK 탭에 보인다. 아무것도 쓰지 않고 점수나 배정을 바꾸지 않는다. 모든 숫자는 스냅숏, LOGBOOK, FLEET 등록부, DISPATCH·SCHEDULE 기록, Linear 프로젝트 조회 하나에 대한 순수 함수다.

| 부분 | 규칙 |
|---|---|
| ROUTE 행 | Linear 프로젝트마다 하나. 열린 FLIGHT가 있거나, 최근 14일 ARRIVED FLIGHT가 있거나, `routes`에 그 프로젝트를 둔 AIRCRAFT가 있거나, 상태 type이 `completed` / `canceled`가 아닌 팀 프로젝트인 것. 바쁜 순(열린 것 + ARRIVED), 다음은 이름 순 |
| 열린 FLIGHT | 화면의 단계 규칙대로: `todo` = 상태 type `unstarted`, `inReview` = 이름이 `In Review`나 `Ready to Merge`인 상태, `inProgress` = 그 밖의 `started`. Backlog, triage, 끝난 것, 상위 이슈는 세지 않는다. atc 스냅숏에 있는 티켓(최근 45일 안에 갱신됨)만 |
| `arrived14` | FLIGHT의 티켓이 그 프로젝트에 있는 최근 14일 LOGBOOK 항목. 스냅숏이 모르는 티켓의 항목과 AD HOC 항목은 어느 ROUTE에도 속하지 않는다 |
| `aircraft` | FLEET `routes`에 그 프로젝트가 든 REGISTRATION(RETIRED AIRCRAFT는 뺌) |
| `landingWaitMedianMin` | 같은 14일 항목의 `landingWaitMin` 중앙값 |
| `goal` | `server/sources/linear-projects.ts`에서 얻은 Linear 프로젝트의 `{targetDate, progress, state}`. 읽기 전용 조회 하나(팀 key로 거른 `projects`; `name targetDate progress status { name type }`), 10분 캐시. `state`는 `status.type`(`backlog`, `planned`, `started`, `paused`, `completed`, `canceled`), 없으면 `status.name`. 폐기된 `Project.state`는 읽지 않는다. key가 없거나, 조회가 실패했거나, 목록에 그 프로젝트가 없으면 `null` |
| AIRCRAFT 행 | `fleetView`(7.2)에서 복사한 `targets`(`flightsPerWeek`, `onTime`)와 `actuals`: `weekDone` = `week`, `onTimeRate` = `onTime.rate`, `landingWaitMedianMin`, `reverts` = `reverted`, `los`. FLEET 카드와 같은 숫자다. RETIRED AIRCRAFT는 뺀다 |
| `trend.days` | 28일(서버 로컬 날짜, 오래된 것부터, 오늘이 마지막): 그날 ARRIVED 수, 그 항목들의 착륙 대기 중앙값, 그날 Revert PR이 머지된 되돌림 수 |
| `trend.gates` | 28일: 그날 내린 DISPATCH·SCHEDULE 그림자 판정(`agreed` / `disagreed`), 그날 끝까지의 누적 일치율(마지막 날은 각 게이트의 `agreement`와 같다), 두 기록을 합친 누적 CROSSCHECK 일치율(`crosscheckRateOf`). 게이트처럼 승인 단계의 approve / reject는 세지 않는다 |
| `sources` | Linear(가져옴), GitHub(가져옴), LOGBOOK 파일을 쓸 수 있었는지 |

### 7.4 OCC 목표 변경 초안 (S1 만듦 2026-09-27, ATC-25)

S1(그림자)은 만들었고 S2(승인하면 적용)는 아직 없다. 이 절 끝의 "만든 대로"를 보라. ROUTES와 TARGETS는 SUPERVISOR의 몫으로 남는다(3장). 이 절은 OCC가 Linear 변경을 제안하듯 이것들의 변경을 제안하되, 결코 적용하지 않는 방법이다.

**작업.** 새 SCHEDULE 종류 둘. 각각 AIRCRAFT 하나에 대한 것이고, `flight: null`과 `aircraft` 필드를 갖는다.

| 종류 | Payload | 예 |
|---|---|---|
| `TARGET` | `{registration, flightsPerWeek?: number \| null, onTime?: number \| null}`. `null`은 목표를 지운다 | TEAM_I `flightsPerWeek` 3 → 5 |
| `ROUTE` | `{registration, add?: string[], remove?: string[]}`(Linear 프로젝트 이름) | TEAM_C에서 `Home & Discovery` 빼기(completed) |

**근거.** OCC는 한 줄 이유를 쓴다. 숫자는 초안을 만들 때 atc가 `GET /api/network`와 같은 함수로 직접 붙인다. 그래서 SUPERVISOR는 OCC가 본 것을 그대로 보고, OCC가 숫자를 잘못 옮길 수 없다.

- `TARGET`: AIRCRAFT 행(targets와 actuals), LOGBOOK에서 본 최근 4주의 주별 ARRIVED 수, 그 routes의 ROUTE 행(기다리는 열린 FLIGHT).
- `ROUTE`: 더하거나 빼는 프로젝트의 ROUTE 행(열린 FLIGHT, `arrived14`, 이미 그 ROUTE에 있는 AIRCRAFT, `goal.state`), 그리고 그 AIRCRAFT의 최근 14일 ARRIVED FLIGHT가 실제로 어느 프로젝트로 갔는지.

**한도.**

- `PATCH /api/fleet`(`applyPatch`)와 같은 검사: `flightsPerWeek` 0–100, `onTime` 0–1. `ROUTE` 이름은 `completed`나 `canceled`가 아닌 팀 프로젝트여야 한다(`remove`는 예외).
- 초안당 변화 한도: `flightsPerWeek`는 최대 2 또는 50%, `onTime`은 최대 0.1. 더 큰 변경은 SUPERVISOR가 손으로 한다.
- `TARGET`은 14일 창에 ARRIVED 항목이 3건 이상 있어야 근거가 된다. RETIRED나 AOG AIRCRAFT에는 초안을 쓰지 않는다. AIRCRAFT와 종류마다 열린 초안은 하나다(새것이 이전 것을 SUPERSEDED). AIRCRAFT당 적용된 `TARGET`은 14일에 하나다(실적 창 하나).
- SCHEDULE 열린 초안 한도(5)에 들고, 다른 초안처럼 3일 뒤 만료된다.
- 자동이 되지 않는다. 일치율이 어떻든 S3 후보가 아니다.

**판정과 승인.**

- **S1(그림자).** 초안이 근거와 함께 SCHEDULE 탭에 보인다. SUPERVISOR가 "나라면 승인 / 거절"을 사유와 함께 표시하고, CROSSCHECK가 먼저 mark를 달 수 있다. 아무것도 쓰지 않는다. 이 판정은 종류별로 따로 세어, Linear 쓰기 게이트(판정 20건, 80%)를 돕지도 해치지도 않는다.
- **S2(승인).** Linear 호출도 linear-guard 단계도 없다. 승인이 곧 쓰기다. 승인하면 atc가 `applyPatch`와 원자적 `fleet.json` 저장(`PATCH /api/fleet/:registration`이 쓰는 경로)으로 payload를 적용하고, FLIGHT RECORDER에 적고, 작업을 바로 `applied`로 표시한다. OCC는 `fleet.json`을 쓰지 않는다.
- **SUPERSEDED**: `fleet.json`에 이미 제안한 값이 있을 때(손으로 바꿈), 또는 AIRCRAFT가 RETIRED일 때.

**끼우는 곳.** `SCHEDULE_KINDS`에 `TARGET`과 `ROUTE`를 더한다. `parsePayload`가 이를 검사한다. `changesOf`는 티켓 대신 FLEET 프로필과 비교한다. `syncLines`는 `loadFleet()`를 본다. `callsOf`는 호출을 돌려주지 않고, S2에서 `approve`는 `release`를 기다리지 않고 바로 적용한다. OCC는 `atcctl schedule draft TARGET|ROUTE`를 얻고, 초안을 쓰기 전에 `GET /api/network`를 읽는다.

**만든 대로 (S1, ATC-25).**

- 순수 검사와 근거는 `server/network-drafts.ts`에 있고(`parseTarget`, `parseRoute`, `networkChangesOf`, `networkSupersedeReason`), `server/schedule.ts`가 끼운다. `aircraft` 필드는 따로 없다. payload의 `registration`이 AIRCRAFT이고 `flight`는 `null`이다.
- payload에는 `from`(초안을 쓸 때의 값)과 `evidence`도 남는다. `TARGET`: NETWORK AIRCRAFT 행, `arrived14`, 4주 `weekly` ARRIVED, 그 routes의 ROUTE 행. `ROUTE`: 건드리는 프로젝트의 ROUTE 행과 `where`(14일 ARRIVED가 간 프로젝트).
- 변화 한도: `flightsPerWeek`는 지금 값의 2나 50% 가운데 **큰 쪽**까지. 지금 값이 없거나(처음 정함) 지울 때는 한도가 없다. `onTime`도 같은 방식으로 0.1까지.
- 판정: `TARGET`·`ROUTE`는 아직 적용하는 길이 없어 **두 모드 모두** 그림자 `verdict`를 받는다. approval 모드의 `approve`·`reject`는 409이고 `callsOf`는 거절한다. SCHEDULE 탭은 두 모드 모두 이 카드에 그림자 버튼을 보인다.
- 세기: `gateOf`는 이 판정을 게이트와 CROSSCHECK 일치율에서 빼고 `gate.network`(`TARGET`, `ROUTE`: 판정 수, 승인했을 것, 합의율)로 따로 보인다. NETWORK 게이트 추세도 뺀다(`countsForGate`).
- `syncLines`는 AIRCRAFT가 없거나 퇴역했거나, `fleet.json`에 이미 그 변경이 있으면(SUPERVISOR가 FLEET 탭에서 바꿈) 열린 초안을 SUPERSEDED로 닫는다.
- OCC는 `atcctl network`를 24시간에 한 번까지 읽고, 한 바퀴에 초안 1건까지 쓴다(`occ/.claude/skills/tick/schedule.md` "TARGET·ROUTE 초안").
- 아직 없음: S2 승인하면 적용(`applyPatch`, 원자적 `fleet.json` 저장, FLIGHT RECORDER)과, 그와 함께 오는 "AIRCRAFT당 적용된 `TARGET`은 14일에 하나" 규칙.

### 7.5 DEPARTURE LOG

왜 필요한가: PR이 머지될 즈음이면 점유가 이미 정리됐거나 3시간 쉰 뒤 다시 시작됐고, 워크트리도 지워진 경우가 많다. 그래서 2026-09-27에 최근 14일 LOGBOOK 62줄 중 48줄에 AIRCRAFT가 없었다. DEPARTURE LOG는 누가 FLIGHT를 시작했는지 그 순간에 적어 둔다.

`~/.local/state/atc/departures.jsonl`에 추가만 하며 둔다(`server/departures.ts`). 서버는 warm tick마다 스냅숏을 STAND별로 마지막에 적은 AIRCRAFT와 비교해 바뀐 것만 쓴다.

```json
{"t":"…","flight":"VOC-201","aircraft":"TEAM_J","stand":"/home/…/worktrees/atc-logbook","branch":"claude/logbook","repo":"/home/…/atc","via":"claim"}
```

| `via` | 언제 | `t` | `aircraft` |
|---|---|---|---|
| `stand` | 서버가 도는 중에 워크트리가 생김 | 지금 | `null`(아직 점유 없음) |
| `claim` | 점유가 없던 STAND를 처음 활성 점유한 `TEAM_X` 세션 | 그 점유의 `since` | 그 AIRCRAFT |
| `handoff` | 기록된 세션이 더는 활성 점유를 갖지 않은 뒤, 다른 `TEAM_X` 세션이 STAND를 가져감 | 새 점유의 `since` | 새 AIRCRAFT |

- main 체크아웃과 `TEAM_X`가 아닌 세션은 무시한다. `flight`는 브랜치의 ticket key이고, AD HOC은 `null`.
- LOSS OF SEPARATION 동안에는 두 세션 모두 활성이므로 기록된 AIRCRAFT가 그대로 남는다. 먼저 있던 쪽이 놓으면 HANDOFF를 쓴다.
- 서버는 시작할 때 파일을 접어 STAND별 마지막 AIRCRAFT를 되살린다. 그래서 재시작해도 두 번 쓰지 않는다. 첫 warm 스냅숏이 기준선이다. 이미 있는 워크트리는 팀이 쥐고 있으면 `claim` 줄을 받지만 `stand` 줄은 받지 않는다.

## 8. FLEET 탭

- AIRCRAFT마다 카드 하나: REGISTRATION과 callsign, 기지 AIRPORT, 상태, 선언한 CREW COMPLEMENT 대 관찰한 CREW, TYPE RATING, ROUTES, LOGBOOK 실적 대 TARGETS(7.2)와 최근 FLIGHT 몇 개.
- AIRCRAFT의 세션에서 [rules-drift hook](../hooks/README.ko.md#rules-drift-hook)이 돌면 RULES 줄(ATC-42): "RULES current", 또는 살아 있는 세션이 아직 확인하지 않은 규칙 파일과 "RULES 미확인 since <시각>". 그 세션은 다음 턴에 diff를 받는다.
- SUPERVISOR용 수정 양식(`fleet.json`을 씀, AIRPORT 등록부와 같은 방식).
- DISPATCH 카드마다 제목 아래 분류(5장). 아직 만들지 않음: FIDS의 분류 표시.

### 8.1 팀 꾸리기

FLEET 탭은 팀을 만들고 내리는 곳이기도 하다. 2026-09-28 전까지 atc는 Claude 세션을 스스로 띄우지 않고 붙여 넣을 브리핑까지만 만들었다. 이제 SUPERVISOR가 LAUNCH·STOP을 누르면 백그라운드 세션을 띄우고 멈춘다(8.5). 브리핑은 새 세션이 처음 받는 지시가 된다.

| 동작 | 용어 | 하는 일 |
|---|---|---|
| 팀 더하기 | **ENTRY INTO SERVICE** | REGISTRATION(다음 빈 `TEAM_X`를 제안), 기지 AIRPORT(기본은 팀 세션이 가장 많은 곳), **CONFIGURATION**. 그 이름의 세션이 나타날 때까지 AIRCRAFT는 NOT IN SERVICE로 보이고, 나타나면 atc가 이름으로 잇는다 |
| 팀 템플릿 | **CONFIGURATION** | `general`(vocado 기본 CREW. 기본값을 따른다), `security`(Opus backend + Codex 리뷰. SEC, DATA, DOCS), `ui`(Opus backend + `ui-builder` + `ui-qa`. UI, DOCS), `research`(Opus backend + `flash-helper`. DATA, DOCS) |
| 세션 시작 | **CREW BRIEFING** | 복사할 수 있는 시작 문구: 세션 이름과 폴더, 만들 CREW와 그 모델, TYPE RATING(SEC 규칙 포함), ROUTE, 교신 규칙(`tail:` 라벨, `READBACK C-xxxx`. `READBACK D-xxxx`는 승인 운용에서만). 사용자가 그 저장소에서 세션을 열고 이름을 붙인 뒤 붙여 넣는다 |
| 팀을 잠시 쉬게 하기 | **AOG** | 사유와 선택적 복귀 날짜. planner가 그 팀에 제안을 멈춘다(`AOG — reason (~date)`) |
| 팀 없애기 | **RETIREMENT** | AIRCRAFT가 FLEET 목록에서 빠진다(날짜·사유와 함께 RETIRED 아래 남음). 제안을 받지 않는다. 살아 있는 세션을 닫지는 않는다. 되살릴 수 있다 |

운항 중인 AIRCRAFT의 COMPLEMENT가 바뀌면 대신 **CREW CHANGE**를 받는다(8.4). SUPERVISOR가 붙여 넣거나, DISPATCH approval 모드에서 승인하면 OCC가 보낸다.

### 8.2 CHECKRIDE

checkride는 조종사가 심사관 앞에서 rating을 가질 자격이 있음을 보이는 비행이다. atc의 CHECKRIDE는 AIRCRAFT마다, TYPE RATING(`SEC`, `UI`, `DATA`, `DOCS`)마다 그 rating이 필요했던 LOGBOOK FLIGHT를 모아 부여나 재검토를 추천한다. 추천만 한다. rating은 SUPERVISOR가 부여(grant)나 회수(revoke)를 눌러야만 바뀌고, 자동으로 부여·회수되는 것은 없다.

**FLIGHT에 어떤 rating이 필요했나.** 이 순서로 보고, 처음으로 rating을 주는 것이 이긴다. 근거마다 출처가 보인다.

1. **라벨**: `classOf`가 FLIGHT의 Linear 라벨(`rating:X`, 또는 `SEC`는 Risk 그룹)에서 읽은 rating. 지금 티켓에서 읽고, 티켓이 더는 로드돼 있지 않으면 LOGBOOK 줄의 `class`에서 읽는다. 아직 `rating:` 라벨을 단 티켓은 적다.
2. **SCHEDULE**: 그 FLIGHT의 CLASSIFY 초안 중 SUPERVISOR가 받아들였고(그림자에서 `agree`, 승인 운용에서 `approve`. 그래서 상태는 agreed, approved, released, applied) rating을 적은 가장 최근 것의 rating.
3. 그 밖에는 그 FLIGHT는 어느 rating의 근거도 아니다. AD HOC FLIGHT는 절대 근거가 되지 않는다.

AIRCRAFT를 아는 LOGBOOK 항목만 센다. 그래서 모든 근거는 그 AIRCRAFT가 실제로 날았던 FLIGHT다.

**제안 기준**(첫 값, 조정 예정. 상수는 `server/checkride.ts`):

| 추천 | 조건 |
|---|---|
| **GRANT** (부여 추천) | AIRCRAFT에 그 rating이 없다. 최근 30일에 그 rating이 필요한 FLIGHT를 3건 이상 ARRIVED했다. 그중 되돌린 것이 없다. Codex 지적 차례(`codexFindings`) 평균이 3 미만이다 |
| **REVIEW** (재검토 추천) | AIRCRAFT에 그 rating이 있다. 최근 14일에 그 rating이 필요한 FLIGHT가 되돌려졌거나, 그런 FLIGHT 2건 이상의 Codex 지적 차례 평균이 3 이상이다 |
| **BLOCKED** | `SEC`에 GRANT가 맞지만, CREW COMPLEMENT에 보안 작업을 할 수 있는 팀원이 없다(`canHoldSec`). 사유가 보이고 부여 버튼은 없다 |
| **BUILDING** | 가지고 있지 않고, 근거가 있지만 아직 모자란다("근거 1/3") |
| **HOLDS** | 가지고 있고, 재검토할 것이 없다 |

**부여와 회수.** `{rating, action: "grant" | "revoke"}`를 담은 `POST /api/fleet/:registration/checkride`는 FLEET 수정 양식과 같은 길(`applyPatch`, 그다음 `fleet.json` 원자적 쓰기)을 간다. 그래서 `SEC` 규칙이 그대로 지켜진다. 그다음 FLIGHT RECORDER에 `checkride` 줄을 쓴다: AIRCRAFT, rating, 동작, 누가(`SUPERVISOR`. FLEET 탭에는 다른 사용자가 없다), 추천이었는지, 근거(LOGBOOK key와 출처). 부여하면 기본 rating 목록이 명시 목록으로 바뀐다.

**API.** `GET /api/fleet/checkride`는 운항 중인 AIRCRAFT와 rating마다 한 행을 돌려준다: 상태, 사유, 수(각 창의 FLIGHT, 되돌림, 평균 Codex 차례), 근거.

### 8.3 선언한 CREW 대 관찰한 CREW

COMPLEMENT는 SUPERVISOR가 선언한 것이다. 관찰한 CREW는 AIRCRAFT의 세션들이 최근 14일 동안 실제로 부른 것이다(`OBSERVED_WINDOW_DAYS`. `GET /api/fleet`도 `observedWindowDays`로 돌려준다). `server/crew-observed.ts`에 있다.

**개인정보.** atc는 세션 메타데이터만 읽는다.

| 읽는 것 | 용도 |
|---|---|
| `~/.claude/projects/<project>/<sessionId>/custom-title.json` → `customTitle` | 세션 이름. 지난 세션을 REGISTRATION에 잇는다 |
| `…/<sessionId>/subagents/agent-<id>.meta.json` → `agentType`, `model` | 누구를 어느 모델로 불렀나(`model`은 호출이 모델을 넘겼을 때만 있다) |
| 메타 파일의 mtime | 호출 시각(메타 파일에는 시각이 없다. 확인한 파일들에서는 mtime이 생성 시각과 같았지만, 메타 파일을 다시 쓰면 시각이 뒤로 밀린다) |
| 세션 폴더, `subagents/`, `<sessionId>.jsonl`의 mtime | 그 세션이 창 안에서 활동했는지. `stat`만 하고 열지 않는다 |

대화 기록(`*.jsonl` 본문), 프롬프트, 메타의 `description`은 읽지도, 저장하지도, 돌려주지도 않는다. 메타 파일은 파싱한 즉시 `agentType`과 `model` 말고는 모두 버린다(`parseMeta`).

**어느 세션인가.** 이름이 REGISTRATION과 같은 세션이 그 AIRCRAFT의 것이다. 스냅숏의 살아 있는 Claude 세션(지금 atc가 AIRCRAFT를 잇는 방식)이거나, `custom-title.json`이 그렇게 말하고 창 안에서 활동한 세션 폴더다. 하나도 없으면 `observedCrew`와 `crewDrift`는 `null`이다(카드에는 "unused"가 아니라 관찰 없음으로 보인다).

**POSITION 대응**(`positionOf`, 선언한 COMPLEMENT 기준):

| 관찰 | POSITION |
|---|---|
| 팀원의 `position`이나 `agent`와 같은 `agentType`(`ui-builder`, `ui-qa`, `flash-helper`, 또는 SUPERVISOR가 agent type으로 선언한 무엇이든) | 그 팀원의 POSITION |
| `model`이 있는 `general-purpose`나 `claude` | `agent`에 그 모델 계열이 든 팀원(`opus` → `claude-opus-5-5` → `backend`). 그런 팀원이 없으면 없음 |
| `model`이 없는 `general-purpose`나 `claude` | Opus로 본다. 호출은 CAPTAIN의 모델을 물려받고, CAPTAIN은 Opus로 돈다. atc는 실제 모델을 볼 수 없으므로 `model`은 `null`로 남는다 |
| 내장 에이전트(`Explore`, `Plan`, `claude-code-guide`, `statusline-setup`)와 그 밖의 agent type | 이름으로 선언하지 않았다면 없음 |

호출은 `agentType`과 `model`로 묶는다: `observedCrew: {agentType, position, model, count, lastAt}[]`, 최근 것부터.

**어긋남**(`crewDrift`):

- `undeclared`: POSITION이 없는 관찰된 호출. agent type별이고, 모델이 주어졌으면 함께 적는다(`Explore`, `general-purpose (sonnet)`). 카드에는 "선언에 없음: Explore"로 보인다.
- `unused`: 창 안에 호출이 없는 선언된 POSITION. 서브에이전트가 아닌 POSITION(`security` CONFIGURATION의 `reviewer` POSITION, agent `codex (GitHub 리뷰)`. GitHub 리뷰로 일한다)은 늘 여기 보인다. 잘못이 아니라 "보지 못함"으로 읽는다.

**비용.** 서버는 `~/.claude/projects`에서 `custom-title.json`을 많아야 30초에 한 번 다시 훑는다. 제목은 파일 mtime으로, 세션별 호출은 `subagents/` 폴더의 mtime으로 캐시한다. 그래서 바뀌지 않은 세션은 다시 읽지 않는다.

**빈틈: agent team 팀원.** CAPTAIN이 Agent 도구로 띄운 팀원(이름이 있든 없든, 백그라운드든 아니든)은 CAPTAIN의 `subagents/` 아래 기록되므로 관찰된다. Claude Code agent team의 팀원 중 별도 세션으로 도는 것(`~/.claude/teams/<team>/` 아래 등록)은 관찰되지 않는다. atc는 팀 설정을 읽지 않고, 그 세션들은 자기 이름을 갖기 때문이다. 선언돼 있으면 `unused`로 보인다. 이들을 보려면 리더 세션을 알려 주는 메타데이터 출처가 필요한데, 아직 쓰는 것이 없다.

### 8.4 CREW CHANGE

SUPERVISOR가 운항 중인 AIRCRAFT의 CREW COMPLEMENT를 `PATCH /api/fleet/:registration`으로 바꾸면 atc가 CREW CHANGE를 쓴다. CAPTAIN에게 줄 문구로, CREW BRIEFING과 비슷하지만 이미 돌고 있는 팀용이다. `server/crew-change.ts`에 있고, `fleet.ts`에 걸린 것은 프로필 저장 뒤의 호출 하나뿐이다. 1단계(아래 앞부분)는 문구와 SUPERVISOR의 손 전달이다. 2단계(나머지)는 DISPATCH approval 모드(2b)에서 OCC가 보내게 한다.

- **운항 중**: RETIRED가 아니고 그 이름의 살아 있는 세션이 있음. 아직 운항을 시작하지 않은 AIRCRAFT는 CREW BRIEFING으로 CREW를 받는다. AOG AIRCRAFT도 운항 중으로 센다.
- **차이**(`diffCrew`): 팀원은 CREW BRIEFING과 같은 한 줄 표기 `position: agent (limits)`로 비교한다. agent나 limits가 바뀐 팀원은 빠지고 다시 들어온 것으로 본다. 문구에서는 한 번 빠지고 다시 들어온 POSITION을 "바뀌는 CREW"로 묶는다.
- **TYPE RATING 영향**(`ratingImpact`): 4.3과 5장의 planner 규칙에서 나온다. `BUILD`/`MAINT`/`TEST`(`flash-helper`가 아니고 `no BUILD`나 `read-only`가 없는 팀원)를 잃거나 얻음, `CHECK`(`no CHECK verdicts`가 없는 팀원), `SEC`를 가질 수 있는지(`canHoldSec`. `applyPatch`는 여전히 그것 없이 `SEC`를 거부한다), 같은 PATCH에서 더하거나 뺀 rating, `ui-builder`와 `ui-qa`가 둘 다 있지 않은데 유지된 `UI`.
- **문구**(`crewChangeText`): 머리 `[ATC FLEET] CREW CHANGE · <CALLSIGN> (<REG>) · CC-0001`, 이어서 빠지는·들어오는·바뀌는 CREW, 새 COMPLEMENT 전체, 영향이 붙은 TYPE RATING, 적용 방법(빠지는 팀원은 지금 일을 마친 뒤 멈추고, 들어오는 팀원은 주어진 agent와 모델로 만들고, 바뀌는 팀원에게 새 limits를 알린다). 끝은 `"<REG> CREW CHANGE CC-0001 COMPLETE"`.
- **기록**: `~/.local/state/atc/crew-changes.jsonl`, 추가만 함. `{"op":"created","id":"CC-0001","registration","at","before":{complement,ratings},"after":{…},"added","removed","ratingImpact","text"}`, 그다음 상태 줄 `{"op":"approved"|"acknowledged"|"delivered","id","at"}`, `{"op":"sent","id","at","message"}`, `{"op":"superseded","id","at","by"}`.
- **손 전달**(두 모드 모두): FLEET 카드가 열린 CREW CHANGE를 복사 버튼과 함께 보인다. SUPERVISOR가 CAPTAIN에게 붙여 넣고 전달함을 누르면 `POST /api/fleet/:registration/crew-change/:id/delivered`가 불린다. `GET /api/fleet/crew-changes?registration=&limit=`는 모든 상태와 시각이 담긴 최근 이력을 돌려준다.

**상태**(`foldCrewChanges`. 지금 상태에 맞지 않는 op는 무시한다):

| 전 | op | 후 | 누가 |
|---|---|---|---|
| `pending` | `approved` | `approved` | SUPERVISOR, FLEET 탭이나 API, approval 모드에서만 |
| `approved` | `sent` | `sent` | OCC, `atcctl crew-change send CC-xxxx` |
| `sent` | `acknowledged` | `acknowledged` | OCC, CAPTAIN의 `READBACK CC-xxxx`를 받은 뒤 `atcctl crew-change readback CC-xxxx` |
| `pending`, `approved` | `delivered` | `delivered` | SUPERVISOR, 전달함(손으로 붙여 넣음) |
| `pending`, `approved` | `superseded` | `superseded` | atc, 더 새로운 COMPLEMENT 변경이 올 때 |

`acknowledged`, `delivered`, `superseded`는 닫힌 상태다. OCC는 CREW CHANGE를 만들거나, 요청하거나, 승인하지 않는다. `atcctl`에는 승인 명령이 없고, OCC Bash guard는 `atcctl`, `jq`, 읽기 전용 `gh`만 허용한다.

**결정(2026-09-27):**

- **승인은 approval 모드에서만.** `POST /api/fleet/:registration/crew-change/:id/approve`는 `dispatch.json`의 `mode`가 `approval`이 아니면 409를 돌려준다. 승인해 두고 기다리는 경우는 없다. shadow에서는 아무도 보내지 않고, 전달함이 shadow의 길이다.
- **`approved`인 것도 손으로 전달할 수 있다.** SUPERVISOR가 shadow로 되돌리거나 먼저 붙여 넣으면 전달함이 그것을 닫고, OCC는 보내지 않는다. `sent`인 것은 전달함으로 닫을 수 없다(409). 이미 CAPTAIN에게 가서 READBACK을 기다리기 때문이다.
- **SUPERSEDED.** `pending`이나 `approved`가 있는 동안 새 COMPLEMENT 변경이 오면 그것을 닫고(`by`는 새 id), 그것의 원래 `before`에서 최신 `after`까지의 차이로 새것을 쓴다. 승인됐던 것은 다시 승인이 필요하다. 그 차이가 비면(CREW가 원래대로 돌아감) 열린 것을 `by: null`로 닫고 새것은 쓰지 않는다. rating만 바꾸는 PATCH는 보내지 않은 CREW CHANGE를 다시 쓰지만(TYPE RATING 줄이 맞게 남도록) 새로 시작하지는 않는다. `sent`인 것은 SUPERSEDED되지 않고 READBACK까지 열려 있다. 그동안 온 새 변경은 지금 선언(`sent` 것의 `after`)과의 차이로 쓰이고, 승인할 수 있지만 기다린다. `crew-change send`는 `sent` 것이 acknowledged될 때까지 그것을 거절한다(409, "READBACK 대기 중인 CC-xxxx").
- **보내기**(`POST /api/fleet/crew-changes/:id/send`, approval 모드에서만): `approved` → `sent`. 정확한 메시지를 저장하고 `{change, sendTo, message}`를 돌려준다. `sent`인 것에는 같은 메시지를 다시 준다(재송신). 메시지(`crewChangeMessage`)는 머리 `[OCC CC-0001] CREW CHANGE · <CALLSIGN> (<REG>)`, 빈 줄, `[ATC FLEET] …` 머리를 뺀 문구(`[OCC CC-xxxx] …` 머리도 빼서 겹치지 않게 한다), 빈 줄, `— 받았으면 이 메시지에 "READBACK CC-0001"로 답장해 주세요.`다. FLIGHT PLAN, RECALL과 같은 형식이다.
- **READBACK**(`POST /api/fleet/crew-changes/:id/readback`): `sent` → `acknowledged`, 모드와 상관없이(shadow로 되돌린 뒤에도 보낸 것은 닫을 수 있어야 한다). "CREW CHANGE CC-xxxx COMPLETE" 줄만 와도 CAPTAIN이 받은 것으로 보고, OCC가 READBACK으로 기록한다.
- **늦음**: READBACK 없이 10분이 지난 `sent`(`CREW_CHANGE_READBACK_OVERDUE_MS`). OCC는 같은 문구를 한 번 다시 보내고(`crew-change send`를 다시), 그다음 SUPERVISOR에게 보고한다.

**send-guard**(`occ/send-guard.mjs`, OCC 세션의 SendMessage hook, fail-closed): `[OCC CC-xxxx]`로 시작하는 메시지는 아래가 모두 맞을 때만 통과한다.

- `GET /api/fleet/crew-changes/:id`가 `{change, mode}`를 돌려주고 `mode`가 `"approval"`
- `change.status`가 `"sent"`(`crew-change send`를 먼저 돌렸음)
- 받는 사람의 이름이 `change.registration`과 같음
- 앞뒤 공백을 뺀 본문이 저장된 `change.message`와 같음

atc에 닿지 않거나, 모르는 id거나, 하나라도 다르면 exit 2로 막는다. DISPATCH 검사는 그대로다.

**화면.** `GET /api/fleet`는 `dispatchMode`와, AIRCRAFT마다 `pendingCrewChange: {id, at, text, added, removed, ratingImpact, status: "pending" | "approved" | "sent", message, approvedAt, sentAt, overdue, waitingFor}`(`openCrewChangeOf`)를 돌려준다. 보내지 않은 것이 있으면 그것을, 없으면 `sent` 것을 acknowledged, delivered, superseded될 때까지 보인다. `waitingFor`는 보내지 않은 것이 뒤에서 기다리는 `sent` 것의 id다. `GET /api/fleet/crew-changes/brief`(`atcctl crew-change brief`)는 OCC에게 `{mode, approved, waiting, sent, overdue, pending}`을 돌려준다.

- `approved`: 보낼 준비가 된 것
- `waiting`: 승인됐지만 `sent` 것 뒤에서 기다리는 것
- `sent`: READBACK을 기다리는 것
- `overdue`: 늦은 id
- `pending`: SUPERVISOR를 기다리는 id

**2b 점검표.** `crew-change` 항목("CREW CHANGE 발부", `selfCheckCrewChange`)은 이 전이, 거절, 메시지, 늦음 규칙, 엔드포인트, `atcctl` 명령을 코드 사실로 확인한다. `vocado-readback` 항목은 vocado `CLAUDE.md`가 `[OCC CC-xxxx]`에도 `READBACK CC-xxxx`로 답할 때만 준비됨이다([dispatch.ko.md](dispatch.ko.md) "2b 켜기 점검표").

### 8.5 세션 조종: LAUNCH와 STOP

2026-09-28에 결정을 바꿨다(SUPERVISOR). atc가 AIRCRAFT 세션을 직접 띄우고 멈춘다. SUPERVISOR는 세션을 하나씩 손으로 열지 않고 FLEET 탭에서 FLEET를 굴린다. 직접 연 세션에 CREW BRIEFING을 붙여 넣는 길도 그대로이고, atc는 전처럼 이름으로 잇는다.

- **방식.** Claude Code 백그라운드 세션. LAUNCH는 base AIRPORT의 본 체크아웃에서 `claude --bg -n <REG> --permission-mode <mode> [--model <model>] "<CREW BRIEFING>"`을 돌린다. `claude agents --json`이 살아 있는 세션(데스크톱·터미널·백그라운드)을 보여 준다. STOP은 `claude stop <id>`다. 대화는 남고 `claude attach <id>`나 `claude --resume`으로 다시 연다. 세션은 `~/.claude/sessions/`에 `kind: "bg"`로 나타나서 RADAR·STRIPS·planner가 다른 세션처럼 본다.
- **API**(`server/session-control.ts`): `GET /api/fleet/sessions`는 이름이 `teamPattern`에 맞는 세션으로 `{max, permissionModes, sessions}`를 돌려준다. `POST /api/fleet/:registration/launch`는 `{permissionMode?, model?}`를 받는다. `POST /api/fleet/:registration/stop`.
- **SUPERVISOR만.** LAUNCH와 STOP은 이 화면의 Origin이 있어야 받는다(`fromThisApp`, AUTOLAND 스위치와 같음). `atcctl`은 Origin을 보내지 않으므로 TOWER·OCC·CROSSCHECK·REVIEW는 세션을 띄우거나 멈출 수 없다.
- **거절**(`launchPlanOf`, `stopTargetOf`, 순수 함수): RETIRED, base AIRPORT 없음, 그 이름의 세션이 이미 떠 있음(종류 상관없음), 백그라운드 세션이 이미 `ATC_MAX_LAUNCHED`개(기본 6, 이 머신의 백그라운드 세션 전부를 셈), permission mode가 `auto`·`acceptEdits`·`default`가 아님(`bypassPermissions`는 주지 않는다), 모델 이름에 `[\w.:[\]-]` 밖의 글자. STOP은 데스크톱·터미널 세션을 거절한다. 그 창에서 닫는다.
- **환경.** 세션은 atc 서비스의 환경이 아니라 깨끗한 환경(HOME, USER, 로캘, XDG runtime, claude CLI와 node가 든 PATH)을 받는다. `.env.local`의 비밀(Linear, TypeSafe)이 세션에 가지 않는다. CLI 경로는 `ATC_CLAUDE_BIN`(기본 `~/.local/bin/claude`. 서비스 PATH에 없다).
- **폴더 신뢰.** Claude Code는 trust 질문을 수락하지 않은 폴더에서 백그라운드 세션을 거절한다. atc는 그 사실을 알리고 trust 설정은 건드리지 않는다. 그 저장소에서 `claude`를 한 번 열어 수락한다.
- **기록.** LAUNCH·STOP마다 FLIGHT RECORDER에 `{kind: "fleet", op: "launch" | "stop", aircraft, by: "SUPERVISOR", ok, jobId, cwd, permissionMode, model, error}` 한 줄.
- **화면.** 세션이 없는 카드에 **LAUNCH**(permission mode, 선택 모델, 상한 대비 백그라운드 수). 백그라운드 세션이면 `BG <id>`와 **STOP**. 백그라운드 세션을 모는 AIRCRAFT를 퇴역시키면 세션도 멈출지 묻는다.

아직 만들지 않음: 수요·가동률로 제안한 LAUNCH·STOP의 실행(FLEET PLAN, 8.6: 그림자 제안은 만들었고 승인 운용은 아직), 오래 도는 세션의 정기 정비로서 RESTART, 새 COMPLEMENT로 다시 띄우는 CREW CHANGE, AIRCRAFT별 사용량 예산(FUEL, GitHub idea #53).

### 8.6 FLEET PLAN: LAUNCH·STOP 등을 제안하기

상태: 1·2단계 만듦(그림자, 2026-09-28). SUPERVISOR 결정은 아래에 적었다. 8.5가 SUPERVISOR에게 조종 버튼을 줬다면, 이 절은 atc가 언제 그 버튼을 쓰자고 제안할지 정한다. 팀을 꾸리고, 세우고, 정비하고, 퇴역시키는 일을 손으로 챙기지 않게 하려는 것이다.

**지금 사실(2026-09-28 06:30 UTC).**

| 신호 | atc가 이미 가진 곳 | 지금 값 |
|---|---|---|
| 수요 | DISPATCH 계획(`assign`, 사유 코드가 붙은 `excluded`, AIRPORT별 슬롯) | 배정할 수 있는 FLIGHT 0건, 제외 2건(상위 이슈) |
| 공급 | FLEET 화면과 `claude agents --json` | AIRCRAFT 10대: VCDO 6(TEAM_A–F), ATCC 3(TEAM_H–J), RNPU 1(TEAM_K). VCDO 팀은 모두 HOLDING이나 PARKED |
| 실적 | LOGBOOK 실적 | 14일 ARRIVED: VCDO 팀 1–5건, ATCC 팀 15–19건 |
| 활주로 | LOGBOOK 착륙 대기, ATFM(출발 중지, 머지 슬롯) | 착륙 대기 중앙값: VCDO 12–48시간, ATCC 2–3분 |
| 상태 | 세션 상태(NORDO), LOS, AOG, CREW drift | AOG 없음, LOS 없음 |
| 사용량 | AIRCRAFT별로는 없음(FUEL, idea #53) | 2026-09-28에 Claude Code가 주간 한도 87% 사용을 보였다 |

여기서 두 가지가 나온다. VCDO의 처리량을 막는 것은 팀 수가 아니라 착륙이다. 오늘 VCDO 팀을 하나 더 띄우면 ARRIVED가 아니라 착륙 대기열의 PR만 늘어난다. 그리고 배정할 수요가 없으니, 처음 쓸모 있는 제안은 LAUNCH가 아니라 세우는(STOP) 쪽이다.

**원칙**(항공사의 fleet planning, crew control, 정비 방식에서. 출처는 이 절 끝):

1. **근거와 함께 제안하고, SUPERVISOR가 정한다.** 항공사의 최적화 도구(crew pairing·rostering, disruption recovery)는 장단점을 밝힌 선택지를 순위대로 내고, 운항 통제가 승인한다. FLEET PLAN 제안에는 숫자가 붙은 사유 코드가 달리고, 그림자 운용으로 시작한다. agree·disagree만 하고, DISPATCH·SCHEDULE과 같은 게이트(판정 20건, 합의율 80%)를 넘어야 승인 운용으로 간다.
2. **되돌릴 수 있는 것만 자동으로.** FLEET 동작 중 스스로 되돌릴 수 있는 것은 atc가 띄운 쉬는 백그라운드 세션의 STOP뿐이다(대화가 남고 다시 이어진다). 자동화 후보는 이것 하나이고, 승인 운용을 거친 뒤 스위치·하루 상한·스스로 꺼지는 조건 뒤에 둔다. LAUNCH는 사용량을 쓰고, RETIREMENT·TYPE RATING·CREW CHANGE는 자동으로 하지 않는다.
3. **용량은 수요와 활주로를 따른다.** GROUND STOP인 AIRPORT, 또는 착륙이 병목인 AIRPORT(착륙 대기 중앙값이 block time 중앙값보다 길거나, 열린 PR이 이미 머지 슬롯을 채움)에는 LAUNCH를 제안하지 않는다.
4. **예비를 둔다.** 항공사의 대기 승무원처럼, 수요가 있는 AIRPORT마다 `reserve`대(기본 1)를 PARKED로 둔다. 예비를 넘는 수요는 LAUNCH를, 예비를 넘는 유휴는 STOP을 부른다.
5. **자격은 강한 조건이다.** LAUNCH·ENTRY 제안은 기다리는 FLIGHT에 필요한 TYPE RATING이나 CONFIGURATION을 적는다(`SEC` AIRCRAFT가 없어 제외된 FLIGHT는 `security` CONFIGURATION을 부른다). planner 규칙과 똑같다.
6. **왔다 갔다 하지 않는다.** 조건이 계획 주기 두 번 이어져야 제안하고, 최근 `minDwell`(기본 2시간) 안에 띄우거나 멈춘 AIRCRAFT에는 반대 제안을 내지 않는다.

**제안 종류.**

| 종류 | 항공사에서 | 언제 제안하나 | 실행(승인 운용) |
|---|---|---|---|
| `LAUNCH` | 예비 승무원 호출 | 한 AIRPORT에서 셀 수 있는 FLIGHT(결정 참고)가 `waitMin`(기본 120분) 기다렸는데 필요한 rating을 가진 가용 AIRCRAFT가 없고, 예비가 모자라고, 활주로가 병목이 아니고, 백그라운드 상한에 여유가 있음. 운항하지 않는 등록 AIRCRAFT가 맞음 | 8.5 LAUNCH |
| `ENTRY` | wet lease | `LAUNCH`와 같은데 맞는 등록 AIRCRAFT가 없음. REGISTRATION·AIRPORT·CONFIGURATION을 제안 | ENTRY INTO SERVICE 뒤 LAUNCH |
| `STOP` | 주기(parking) | atc가 띄운 백그라운드 세션이 `idleHours`(기본 12) 동안 STAND·FLIGHT·활동이 없고, 그것 없이도 AIRPORT의 예비가 유지됨 | 8.5 STOP(다시 이어짐) |
| `RESTART` | 정기 점검 | 백그라운드 세션이 PARKED이고 `restartDays`(기본 3)보다 오래됨 | STOP 뒤 새 CREW BRIEFING으로 LAUNCH |
| `AOG` | 기한이 있는 MEL 유예 | 세션이 NORDO이거나 최근 24시간에 LOS | `until` = 지금 + 24시간으로 AOG. 풀리지 않고 기한이 지나면 `RETIRE`나 복귀 제안이 뒤따름 |
| `RETIRE` | 퇴역 | `retireDays`(기본 30) 동안 ARRIVED 없음, 예비에 필요 없음, 열린 PR 없음 | SUPERVISOR만, 자동 없음 |

**기록과 화면.** `fleet-plan.jsonl`, 추가만 함: `{op: "create", id: "F-0001", kind, aircraft, airport, reasons: [{code, detail, value}], at}`, 이어서 `{op: "verdict", id, verdict: "agree" | "disagree", by, at}`, `{op: "expire" | "supersede", id, at}`, 승인 운용에서는 `{op: "approve" | "executed", id, at, jobId?}`. `GET /api/fleet/plan`이 열린 제안, 최근 제안, 게이트를 돌려준다. FLEET 탭 카드 위에 FLEET PLAN 블록이 생기고, 제안마다 사유와 agree·disagree가 붙는다. 승인 운용은 approve를 더하며, 8.5의 버튼과 같은 코드를 돌리고 FLIGHT RECORDER에 `by: "FLEET PLAN F-0001"`로 남긴다. 계획은 DISPATCH 주기(5분)에 돌고 읽기만 한다.

**만든 것(1·2단계, 그림자, 2026-09-28).**

- **순수 함수**(`server/fleet-plan.ts`): `fleetPlanOf(inputs)`가 후보와 AIRPORT별 수요 줄을 돌려준다. `persistOf`는 후보를 두 주기, LAUNCH·ENTRY는 `waitMin` 동안 지켜본다. `syncFleetPlan`은 기록 줄을 만든다: `create`, 조건이 풀리면 `expire`, 같은 열쇠가 다른 종류나 AIRCRAFT를 가리키면 `supersede`. 판정한 제안은 24시간 다시 내지 않고, `minDwell` 안에는 반대 제안(LAUNCH ↔ STOP·RESTART)을 내지 않는다. 게이트는 `fleetPlanGateOf`다.
- **수요.** planner를 `candidateTeams`를 `LINEAR_TEAM_KEYS`의 모든 팀으로 바꿔 한 번 더 돌린다. 새 `unserved` 목록에는 제외 규칙을 모두 통과했는데 AIRCRAFT를 받지 못한 FLIGHT가 들어간다(`no-aircraft`, `unqualified`, `no-tail`). AIRPORT의 AIRBORNE 슬롯이 차서 남은 FLIGHT는 세지 않는다.
- **위 규칙을 이렇게 읽었다.**
  - LAUNCH의 "예비가 모자람"은 받을 곳 없는 수요에서 따라 나온다. 자격 있는 PARKED AIRCRAFT가 있었다면 배정됐을 것이기 때문이다. 예비 규칙은 STOP과 RETIRE에서 작동한다.
  - 활주로 병목은 그 AIRPORT의 14일 착륙 대기 중앙값이 block time 중앙값보다 길 때다. 기록이 없으면 병목이 아니다.
  - LAUNCH를 막는 GROUND STOP은 `kind: stop`만이다. 그림자든 실제로 막는 중이든 같다.
  - STOP·RESTART는 atc가 띄운 것만이 아니라 모든 백그라운드 세션(`claude agents --json`의 `kind: background`)을 본다.
  - ENTRY는 `tail:` FLIGHT를 받지 않는다.
  - LOS는 최근 24시간 FLIGHT RECORDER의 `alert.raised` conflict다. NORDO는 죽은 세션이 있고 같은 이름의 살아 있는 세션이 없는 것이다.
  - RETIRE는 들인 지 `retireDays`가 안 된 AIRCRAFT를 건너뛴다.
- **실행부**(`server/fleet-plan-run.ts`): DISPATCH 주기에 돈다. Linear·GitHub을 아직 못 읽었거나 `claude agents`가 실패하면 그 주기를 건너뛰고, 열린 제안은 그대로 둔다. 지속 조건의 시각은 메모리에 두므로 서버를 다시 띄우면 처음부터 센다.
- **API.** `GET /api/fleet/plan`은 `{mode, config, ranAt, error, demand, open, waiting, recent, gate}`를 돌려준다. `open[].now`는 지금 계산한 사유다. `waiting`에는 지속 조건을 기다리는 후보가 들어가고, 판정 뒤 쉬는 후보는 빠진다. `POST /api/fleet/plan/:id/verdict`는 `{verdict: "agree" | "disagree", reason?}`를 받는다. 이 화면의 Origin이 있어야 하고(아니면 403), 닫힌 제안에는 409를 돌려준다.
- **탭.** 카드 위에 FLEET PLAN 블록이 있다. 게이트, AIRPORT별 수요 한 줄과 LAUNCH를 막는 이유, 사유가 붙은 열린 제안과 반대·동의 버튼, 지켜보는 후보, 최근 닫힌 제안이 보인다.
- **운영 데이터로 처음 본 결과(2026-09-28 07:15 UTC):** 제안 없음. ATC-35는 TEAM_I가 받을 수 있고, 나머지 열린 ATC FLIGHT는 우선순위가 없다. 팀 세션은 모두 데스크톱 세션이다. NORDO·LOS가 없고, 모든 AIRCRAFT가 30일 안에 ARRIVED했다.

아직 안 만든 것: 3단계(승인 운용)와 4단계(자동 STOP), 기한이 지난 AOG 뒤의 제안(RETIRE나 복귀), 활주로 규칙의 머지 슬롯 점유, 주간 사용량 줄(FUEL), FLEET PLAN 제안의 CROSSCHECK mark.

**구현 순서.**

1. ✅ 순수 함수 `fleetPlanOf(snapshot, fleet, dispatchPlan, logbook, sessions, atfm, config, now)`와 종류마다, 그리고 왔다 갔다 방지 규칙의 테스트.
2. ✅ 그림자: 기록, API, FLEET PLAN 블록, agree·disagree, 게이트.
3. 승인 운용(`dispatch.json`이나 별도 파일의 스위치): approve가 8.5와 프로필 수정으로 실행.
4. atc가 띄운 쉬는 세션의 자동 STOP만: 스위치, 하루 상한, 7일에 SUPERVISOR가 두 번 되돌리면 꺼짐.

**위험.**

| 위험 | 대응 |
|---|---|
| LAUNCH·STOP이 왔다 갔다 함 | 두 주기 지속, `minDwell`, 예비를 이력(hysteresis)으로 |
| 사용량이 바닥남 | 백그라운드 상한(8.5), LAUNCH는 자동 없음, FUEL이 생기면 블록에 주간 사용량 줄 |
| 수요 신호가 틀림(상위 이슈, 라벨 없음) | planner의 제외 규칙을 통과한 FLIGHT만 센다. 제외된 FLIGHT는 보이기만 하고 세지 않는다 |
| 팀은 늘었는데 착륙 대기열은 그대로 | 활주로 규칙(원칙 3) |
| RESTART가 쓸모 있는 맥락을 잃음 | PARKED 세션만. 옛 대화는 남아서 다시 이어진다 |

**결정 (2026-09-28, SUPERVISOR).**

- 기본값은 제안대로: `reserve` 1, `waitMin` 120, `idleHours` 12, `restartDays` 3, `retireDays` 30, `minDwell` 2시간. 이후 조정은 그림자 기록과 게이트로 정한다.
- ATC FLIGHT도 수요로 센다. FLEET PLAN은 `candidateTeams`만이 아니라 `LINEAR_TEAM_KEYS`의 모든 팀에서 열린 FLIGHT를 세고, 제외 규칙은 planner와 같다(상위 이슈, 닫힌 상태, 다른 AIRCRAFT로 가는 `tail:`). DISPATCH는 여전히 `candidateTeams`만 배정하므로, ATC 수요로 나온 LAUNCH는 ATC를 거기 넣기 전까지 직접 배정(structure나 사람)에 쓰인다. ATC FLIGHT도 워크스페이스 분류 라벨을 쓴다. 라벨이 없는 FLIGHT는 rating 확인을 건너뛰고 사유에 그렇게 적는다.
- 4단계(자동 STOP)는 계획에 두되 마지막에 만들고, 스위치는 기본으로 꺼 둔다. 켜는 것은 그림자 게이트를 통과한 뒤 SUPERVISOR가 따로 정한다.

출처: [Jeppesen crew pairing](https://ww2.jeppesen.com/airline-crew-optimization-solutions/airline-crew-pairing/), [Lufthansa Systems NetLine/Crew](https://www.lhsystems.com/solutions/operations-control-center/netline-crew), [항공 disruption recovery 조사(arXiv 2510.26831)](https://arxiv.org/html/2510.26831), [OAG: wet leasing](https://www.oag.com/blog/what-is-wet-leasing), [SKYbrary: MEL](https://skybrary.aero/articles/minimum-equipment-list-mel), [EASA AI 등급(Halldale)](https://www.halldale.com/civil-aviation/easa-ai-framework-aviation-safety-regulations), [ICAO: 항공기 주기](https://www.icao.int/operational-safety/Aircraft-Parking).

## 9. `lane:`에서 `tail:`로 옮기기

네 단계 모두 끝났다.

1. ✅ planner는 `tail:`을 읽고, 2026-10-10까지 `lane:`을 별칭으로 계속 읽는다. `lane:` FLIGHT의 제외 사유에는 `(옛 lane: 라벨 — tail:로 바꿀 것)`이 붙는다. 2026-10-10(KST, `LANE_CUTOFF`)부터 planner는 `lane:`을 읽지 않는다. `lane:` 라벨만 붙은 FLIGHT는 어느 팀에도 제안하지 않고 `옛 lane:TEAM_X 라벨은 2026-10-10부터 읽지 않음 — tail:TEAM_X로 바꿀 것`으로 제외하며, `tail:`도 붙은 FLIGHT는 `tail:`을 따른다.
2. ✅ Linear 라벨 `tail:TEAM_A` … `tail:TEAM_F`를 만들고 VOC-196에 `tail:TEAM_E`를 붙였다(2026-09-26 SUPERVISOR 승인).
3. ✅ President에게 알렸다: 배정은 Linear에 `tail:TEAM_X`로 한다. OCC 인계는 occ.ko.md 8장을 따른다.
4. ✅ `occ/CLAUDE.md`, README, CHANGELOG에서 이름을 바꿨다.

## 10. 구현 순서

1. ✅ planner의 `tail:`과 `lane:` 별칭. 이어서 Linear 라벨, VOC-196, President에게 알림
2. ✅ `fleet.json` 등록부, API, FLEET 탭(읽기와 수정). 기본값은 vocado CREW 규칙에서. 선언한 COMPLEMENT 옆의 관찰한 CREW와 CREW CHANGE(문구, 그리고 approval 모드에서 OCC가 보내기)는 8.3, 8.4
3. ✅ planner가 분류 라벨을 읽음: TYPE RATING·FLIGHT TYPE 강한 규칙, WAKE 슬롯, ROUTE 점수(Risk 그룹은 SEC로 셈. 라벨 그룹은 `group:name`으로 읽음), HOLDING·PARKED 팀의 STAND 없는 FLIGHT와 CHECK 독립성(5.1, 5.2)
4. ◐ DISPATCH 카드에 분류 표시. 남은 일: FIDS, 라벨이 없을 때 분류를 제안하는 DISPATCH 메모
5. ✅ OCC S1 `CLASSIFY` 초안(occ.ko.md의 SCHEDULE 작업과 함께. `server/schedule.ts`, 6장)
6. ◐ FLEET 카드의 LOGBOOK 기반 TARGETS 실적(7.1, 7.2)과 NETWORK의 프로젝트 목표 옆 표시(7.3). 남은 일: 분류별 중앙값으로 정시 기준 잡기, OCC 목표 변경 초안의 S2(7.4, S1은 만듦)
7. ✅ FLEET 탭의 팀 꾸리기(8.1): ENTRY INTO SERVICE, CONFIGURATION, CREW BRIEFING, AOG, RETIREMENT
8. ✅ CHECKRIDE(8.2): LOGBOOK의 TYPE RATING 근거, GRANT·REVIEW 추천, SUPERVISOR의 부여·회수
9. ✅ 세션 조종(8.5): FLEET 탭의 LAUNCH·STOP. 남은 일: 수요 기반 제안의 승인(FLEET PLAN, 8.6, 그림자는 만듦), RESTART, 다시 띄우는 CREW CHANGE, 사용량 예산

## 11. 위험과 대응

| 위험 | 대응 |
|---|---|
| 라벨이 실제와 어긋남(사실은 "H"인 "M") | 먼저 그림자 `CLASSIFY`. 정시 데이터가 오래 걸리는 분류를 보여 준다. CAPTAIN이 재분류를 보고할 수 있다 |
| 강한 규칙이 너무 많아 배정할 것이 없음 | 모든 제외에 규칙이 보인다. SUPERVISOR가 `tail:`을 떼거나 rating을 더할 수 있다 |
| 선언한 CREW와 실제 CREW가 다름 | FLEET 탭이 선언과 관찰을 나란히 보여 준다 |
| Linear 라벨이 어지러워짐 | 축 넷만, 한 번만 만든다: `tail:`과 `rating:`은 평면 라벨, `type`과 `wake`는 라벨 그룹. vocado의 기존 Risk 그룹도 `SEC`로 읽으므로 새 라벨이 필요 없다 |
| `SEC`를 너무 쉽게 줌 | `rating:SEC` 변경과 AIRCRAFT의 `SEC` rating에는 늘 SUPERVISOR가 필요하다 |
| atc가 띄운 세션이 사용량을 쓰고 권한으로 움직임 | SUPERVISOR가 눌러야만 띄움, 살아 있는 백그라운드 세션 상한, `bypassPermissions` 없음, atc 비밀이 없는 깨끗한 환경, LAUNCH·STOP 모두 FLIGHT RECORDER에(8.5) |

## 결정 (2026-09-26, SUPERVISOR)

| 항목 | 결정 |
|---|---|
| 팀 개념 | atc 용어로 더 발전시킨다. CREW 구성과 목표까지 포함 |
| 미리 배정 | President 알림, Linear 라벨, VOC-196을 여기서 정한 이름으로 진행 |
| 난이도 분류 | 필요. FLIGHT TYPE, WAKE CATEGORY, 필요한 TYPE RATING으로 여기에 넣음 |
| 팀 이름 | `TEAM_X`를 **REGISTRATION**으로 유지한다. 사용자가 붙이는 세션 이름이고, vocado 규칙, President, `tail:` 라벨, `teamPattern`이 모두 여기에 기댄다. atc의 말로 팀은 **CAPTAIN** 아래 **CREW**가 모는 **AIRCRAFT**이고, callsign(ECHO)으로 부른다. "팀"이라는 말은 REGISTRATION에서, 그리고 사람과 이야기할 때만 쓴다 |
| 팀 꾸리기 | FLEET 탭에서: ENTRY INTO SERVICE, CONFIGURATION 템플릿, CREW BRIEFING, AOG, RETIREMENT. atc는 세션을 띄우지 않는다(2026-09-28에 바꿈, 아래) |
| 세션 조종 (2026-09-28) | atc가 AIRCRAFT 세션을 직접 띄우고 멈춘다(`claude --bg`, `claude stop`). FLEET 탭에서 SUPERVISOR가 누를 때. 자동 제안은 나중에, 먼저 그림자 판정으로(8.5) |
| Linear 라벨 | `type`(BUILD … FERRY)과 `wake`(L … J)는 Vocado 팀에 단일 선택 라벨 그룹으로 만들었다. `tail:TEAM_A` … `tail:TEAM_F`는 당분간 평면 라벨로 둔다(President가 이미 쓴다) |
| 첫 FLEET 프로필 | 운항 이력에서: TEAM_B, TEAM_D, TEAM_E는 `SEC`(보안·DB FLIGHT)를 갖고 route는 Beta Readiness. TEAM_F는 route Song Experience. TEAM_C는 routes Vocado Visual System (SEED)와 Home & Discovery. TEAM_A는 기본값 |

남은 결정: 정확한 TYPE RATING 목록(`SEC`, `UI`, `DATA`, `DOCS`로 시작), WAKE 슬롯 가중치, Linear 추정치가 WAKE를 따라가야 하는지.
