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
> - FLEET PLAN 그림자·승인 운용과 REFRESH(8.6, 8.7, ATC-69)
> - FLEET 목록의 FOB(ATC-81)
> - 세션 이름 표기를 REGISTRATION 하나로 읽기(ATC-67)
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

### 두 글자 REGISTRATION as built (ATC-181)

`TEAM_Z` 다음 REGISTRATION은 `TEAM_AA`, `TEAM_AB` … `TEAM_ZZ`다(모두 26 + 676개). REGISTRATION은 그대로 불투명한 이름이다: 바꾸거나 다시 쓰지 않고, 퇴역한 것도 쓴 것으로 남는다.

- **규칙 하나.** `server/registration.ts`의 `DEFAULT_TEAM_PATTERN`이 `^TEAM[\s_-]?[A-Z]{1,2}$`이고, 모든 곳이 여기나 DISPATCH의 `teamPattern`에서 읽는다. 어떤 표기든 정식으로 맞춘다(`Team AB`, `team-ab`, `TEAMAB` → `TEAM_AB`). 한 글자 이름은 그대로다. `TEAM_ABC`와 `TEAM_1`은 팀 이름이 아니다. 소스에 한 글자짜리 팀 정규식을 새로 하드코딩하면 테스트가 실패한다.
- **`nextRegistration`**(ENTRY INTO SERVICE)은 `TEAM_A` … `TEAM_Z`, `TEAM_AA` … `TEAM_ZZ` 가운데 비어 있는 첫 번호를 주고, 다 쓰면 `null`이다. 등록됐거나 살아 있는 REGISTRATION(퇴역 포함)은 쓴 것으로 센다.
- **콜사인.** 글자마다 음성 알파벳 한 단어: `TEAM_G` → GOLF, `TEAM_RA` → ROMEO ALPHA(`server/callsign.ts`, 화면과 같이 씀). RADIO 문구와 콜사인별 목소리는 전체 콜사인을 쓴다.
- **정렬.** REGISTRATION으로 정렬하는 곳(FLEET 목록, NETWORK, METRICS FUEL, CHECKRIDE, RADIO의 AIRCRAFT 거르기)은 글자 수가 먼저, 그다음 알파벳순이다(`compareRegistration`): `TEAM_B`, `TEAM_Z`, `TEAM_AA`, `TEAM_AB`.
- **하지 않은 것.** 비슷한 콜사인이 동시에 활동할 때(ROMEO와 ROMEO ALPHA)의 경고는 아직 없다. 기존 `fleet.json` 키, LOGBOOK 줄, `tail:` 라벨은 건드리지 않는다.

### REGISTRATION 표기 as built (ATC-67)

세션 이름을 어떻게 적었든 atc는 한 REGISTRATION을 어디서나 같게 읽는다. `server/registration.ts`의 `registrationOf(name, teamPattern)`는 DISPATCH `teamPattern`이 받는 이름을 정식 표기(대문자, `_`)로 바꾼다(`Team G`, `TEAM-G`, `team_g`, `TEAMG` → `TEAM_G`). 구분자가 없으면 규칙이 받는 첫 자리에 `_`를 넣으므로, `teamPattern`을 바꾸면 그 규칙이 정한다. 규칙이 받지 않는 이름(TOWER, OCC, President)은 `null`이고 전처럼 대문자로 비교한다.

- **읽기.** 세션·AIRCRAFT 이름을 REGISTRATION과 비교하는 곳은 모두 이것을 쓴다: FLEET(`fleetView`, 카드 API, ENTRY INTO SERVICE), DISPATCH(tail, CHECK 독립성, FUEL 조회, `crew.ts`의 프로필·ACCOUNT), CREW CHANGE, 관찰한 CREW, CHECKRIDE, BRIEFING, FLEET PLAN, ATFM 자동 배정 판정, FUEL 구성원·FUEL BURN, FLIGHT FOLLOWING, 세션 조종(`sameName`), `tail:` 라벨(`tail:team-g`도 `TEAM_G`), TAIL 초안. `fleet.json` 키가 `Team_G`로 적혀 있어도 찾고, 바꿔 쓰지 않는다.
- **새 기록.** LOGBOOK `aircraft`, DEPARTURE LOG 줄, FLIGHT RECORDER `fleet`·`checkride` 줄, FLEET PLAN 제안, atc가 띄운 세션은 정식 REGISTRATION을 쓴다. 옛 줄은 표기를 그대로 두고 읽을 때 맞춘다. 두 기록은 일부러 살아 있는 세션 이름을 둔다. `occ/send-guard.mjs`가 정확히 맞춰 보는 SendMessage 수신자이기 때문이다: DISPATCH 제안의 `aircraftName`, CREW CHANGE의 `registration`(SUPERVISOR 결정, 2026-09-28). guard는 바꾸지 않았다.
- **FLEET.** 살아 있는 팀 세션의 이름이 정식 표기가 아니면 그 AIRCRAFT에 한 줄 힌트 `세션 이름 Team G → TEAM_G로 바꾸면 좋다`와 상태 목록의 작은 `이름` 표시가 보인다. 세션은 그대로 잇는다. 같은 REGISTRATION으로 읽히는 살아 있는 세션이 둘 이상이면 합치지 않고 충돌로 보인다(`세션 2개가 TEAM_H로 읽힘: …`, 실선 `세션 2개` 표시). 어느 쪽이 SUPERSEDED인지 정하는 것은 idea [#96](https://github.com/chaehy5665/atc/issues/96)이다.

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

### TAIL drafts as built (ATC-68)

FLIGHT에 `tail:`을 붙이는 쪽(TAIL ASSIGNMENT). OCC가 SCHEDULE `TAIL` 작업([occ.ko.md](occ.ko.md) "TAIL as built") 초안을 쓴다. CHARTER DESK의 SUPERVISOR 지시에서, 또는 `tail:` 없이 팀이 이미 몰고 있는 FLIGHT(STAND, DEPARTURE LOG, READBACK)의 atc 신호에서 나온다.

- 승인되고 발부되면 FLIGHT의 `tail:`을 그 REGISTRATION 하나로 정한다. 다른 `tail:` 라벨은 떼고, 나머지 라벨(`lane:` 포함)은 그대로 둔다.
- AIRCRAFT는 FLEET에 있고 RETIRED가 아니어야 하고, 평면 Linear 라벨 `tail:TEAM_X`가 이미 있어야 한다. 라벨은 ENGINEERING이나 사용자가 만든다. OCC는 만들지 않는다.
- 워크스페이스는 `tail` 그룹이 아니라 평면 `tail:TEAM_X` 라벨을 쓴다. 그룹의 자식 라벨은 찾지 못해 초안이 거절된다.
- 다른 팀의 `tail:`을 그 팀이 AIRBORNE이거나 그 FLIGHT의 STAND를 쥔 채 바꾸면 CAUTION이 붙는다.
- ENGINEERING과 사용자는 지금처럼 손으로 `tail:`을 붙여도 된다.

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
| 표시 | 0점 요소 `STAND 없이`와 AIRCRAFT 상태: `VOC-10 아직 진행 중(PR 없음) — SURVEY는 STAND가 필요 없어 STAND 규칙 밖(AIRCRAFT당 1건)` |
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

**ARRIVED 후보, 만든 대로(2026-09-28, ATC-72).** 이제 감지가 있다. 다만 OCC가 확인하는 제안일 뿐이고, atc는 ARRIVED를 스스로 적지 않는다.

- **누가 했나.** GitHub·Linear는 계정 하나로 쓰여서 작성자로 팀을 알 수 없다. 그래서 그 FLIGHT를 모는 AIRCRAFT의 세션 기록을 읽는다. `post` 사건(`briefs.ts` `ghPostOf`)은 그 세션의 `gh pr review|comment <N>`, `gh issue comment <N>`, 본문을 준 `gh api …/pulls/<N>/reviews`·`…/issues/<N>/comments`, Linear MCP `save_comment` 호출이다. GitHub 리뷰·댓글은 그 호출 1분 전 ~ 10분 뒤에 GitHub에 실제로 있을 때만 센다(읽기 전용 `gh`). AIRCRAFT를 모르면 후보가 없다.
- **CHECK**(`checkSuggestionOf`): 검토하는 팀이 출발 뒤 대상 PR에 남긴 리뷰(상태 무관), 또는 PR 댓글(다른 `kind`). 대상은 `checkTargetOf`(5.2)에서 온다: 제목의 PR 번호(FLIGHT의 AIRPORT 저장소), 티켓이 대상인 열린 PR, 대상 FLIGHT의 LOGBOOK PR.
- **SURVEY**(`surveySuggestionOf`): 모는 팀이 출발 뒤 남긴 것 중 이 순서로.
  1. FLIGHT key를 담고 문서만(`docs/`, `.md`, `.txt` …) 바꾼 머지 PR. 팀은 LOGBOOK의 AIRCRAFT로 안다.
  2. 명령에 FLIGHT key가 적힌 GitHub PR·이슈 댓글.
  3. 결과 링크를 단 그 FLIGHT의 Linear 댓글. 세션 기록만으로 찾으므로, 이유에 Linear에서 확인하라고 적힌다.
- **후보.** FLIGHT, AIRCRAFT, D-xxxx(없으면 null), `kind`, 증거(`url`, `author`, `at` = 일이 끝난 시각), 이유 한 줄(`reason`), 확인 뒤 칠 `command`. 5분마다 다시 찾는다(`standfree-run.ts`). `dispatch brief`의 `arrivalCandidates`, DISPATCH 카드 IN FLIGHT 줄의 "ARRIVED 후보", 직접 배정이면 그 아래 "ARRIVED 후보" 목록에 보인다. `GET /api/standfree`가 목록과 지표를 준다.
- **직접 배정(shadow, D-xxxx 없음).** 팀이 STAND 없는 FLIGHT를 READBACK한 때가 착수다. SendMessage든 `READBACK <KEY>` 답 글이든 된다. DEPARTURE LOG에 `{via: "readback", stand: null}`로 적는다(7.5). FLIGHT·AIRCRAFT마다 한 줄이고, 그 짝이 ARRIVED한 뒤에만 다시 적는다. FLIGHT PLAN으로 보낸 짝은 DISPATCH에 맡긴다. OCC가 `atcctl dispatch arrived <FLIGHT> --aircraft <TEAM_X> -- '<링크>'`로 확인한다(`POST /api/dispatch/standfree/:flight/arrived`). STAND가 필요하거나 모르는 FLIGHT, 그 FLIGHT의 D-xxxx가 떠 있을 때, readback 착수가 없을 때, 그 착수가 이미 ARRIVED했을 때는 거절한다.
- **LOGBOOK.** 확인된 STAND 없는 ARRIVED(D-xxxx든 직접이든)는 `pr` 없는 `arrived` 줄을 쓴다. `key: "standfree:<FLIGHT>@<departedAt>"`, `departedFrom: "readback" | "departure"`, `stands: []`, `landingWaitMin: null`, `blockMin` = 착수 → 일이 끝난 시각(후보의 증거 시각, 없으면 확인 시각)이다. `standFree: {arrivedVia: "report" | "confirmed-suggestion", evidence: {url, note}, workDoneAt, proposal}`도 붙는다.
  - TARGETS·CHECKRIDE·FUEL F4(그 AIRCRAFT의 FLIGHT 구간)가 센다.
  - PR이나 착륙 대기가 필요한 곳은 뺀다: MCC gate, SCHEDULE CLOSE, 착륙 대기 중앙값, 지시서 측정. STAND가 필요한 곳도 뺀다: PR의 DEPARTURE LOG 맞추기, EN ROUTE FUEL 구간.
  - planner는 끝난 FLIGHT로 본다("이미 완료됨 — STAND 없이 ARRIVED(LOGBOOK)").
  - 같은 FLIGHT·AIRCRAFT가 착수 뒤 이미 PR로 LOGBOOK에 있으면 두 번째 줄을 쓰지 않는다.
  - 옛 줄은 그대로 읽힌다.
- **지표**(`timelinessOf`, `gate3.standFree` 옆 `timely`): 최근 30일 STAND 없는 ARRIVED 줄 중 일이 끝난 뒤 24시간 안에 확인된 비율. 보고만 있는 줄은 보고가 곧 신호라 제때로 센다. 24시간 넘게 확인되지 않은 후보는 놓친 것으로 센다.

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
- 사람 없이 끝나는 ARRIVED. 지금은 atc가 STAND 없는 FLIGHT의 ARRIVED 후보를 찾고 OCC가 확인하면, TARGETS에 세는 PR 없는 LOGBOOK 줄이 적힌다(ATC-72, 5.1.1 as built)

ATFM의 자동 대상 판정(A8)은 여전히 배정 가능한 AIRCRAFT를 요구한다. 그래서 HOLDING 팀에 간 STAND 없는 제안은 자동 대상이 되지 않는다(어차피 A3가 SURVEY와 CHECK를 뺀다).

### File overlap as built (ATC-71)

DISPATCH는 날고 있는 FLIGHT가 바꾼 파일과 Todo FLIGHT가 고칠 파일을 읽어 겹침을 점수에 넣는다(WAKE 가중, `파일 겹침`). `dispatch.json`의 `overlap.hold` 스위치(기본 꺼짐)를 켜면 그 파일을 잡은 FLIGHT가 머지될 때까지 기다리게 한다. 겹치는 FLIGHT를 이미 날고 있는 팀에는 `이어서 하면 충돌 없음`을 준다. 규칙·읽는 곳·`DIRTY` 지표는 [dispatch.ko.md](dispatch.ko.md) 5.3.1에 있다.

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

**스위치**는 `~/.local/state/atc/judges.json`의 `judges.jev`다: `off`(기본), `replay`, `shadow`. SUPERVISOR만 바꾼다. 설정 창 → AUTOMATION → JUDGES에서 바꾸거나, 이 화면 Origin으로 `PUT /api/settings {judgesJev}`를 보낸다(AUTOLAND와 같다). atcctl에는 명령이 없어 관제 세션은 바꿀 수 없다. 값이 없거나 모르는 값이면 `off`로 읽는다.

| 모드 | 판정하는 것 |
|---|---|
| `off` | 아무것도 읽거나 보내지 않는다 |
| `replay` | SUPERVISOR가 판정한 CLASSIFY 초안 가운데 이 계열의 mark가 없는 것, 오래된 것부터. 본문은 지금 읽은 것이라 초안을 쓸 때와 다를 수 있다 |
| `shadow` | mark가 없는 열린 CLASSIFY 초안 |

서버는 1분에 3건까지만 돌린다. 오류가 난 초안은 한 시간 뒤에 다시 하고, 401·429가 나면 그 바퀴를 멈춘다. 마지막 실행과 오류는 설정 창에 보인다.

**반출 규칙.** 스위치를 `replay`나 `shadow`로 켜는 것이 SUPERVISOR의 데이터 반출 결정이다. 나가는 것은 허용 목록뿐이다: 제목과 본문의 세 칸(목표, 수정 허용 범위, 완료 기준), 칸마다 600자까지. FLIGHT key, 라벨, 댓글, 담당, 프로젝트, 다른 칸은 보내지 않는다. `rating:SEC`·`Risk:*` 라벨이 있는 FLIGHT, 라벨을 모르는 FLIGHT, `rating:SEC`를 붙이는 초안은 **제목만** 보내고 본문은 읽지도 않는다. mark마다 보낸 칸(`sent`)과 본문을 뺀 까닭(`withheld`)이 남는다.

**기록.** `~/.local/state/atc/judges.jsonl`에 추가만 한다. 초안·계열마다 `judge` 줄(분류, 확률, 판정, 엔진, 모델, run)이 쌓이고, 스위치를 바꿀 때마다 `mode` 줄이 붙는다. `schedule.jsonl`과 CROSSCHECK 한 칸은 건드리지 않는다.

**쏠림 없이 재기.** mark는 SUPERVISOR가 판정한 초안에만 보인다. RECENT에 `JEV agree` 같은 칩으로 보이고, 툴팁에 분류와 보낸 범위가 있다. 열린 초안의 mark는 세기만 하고 숨긴다. 점검 패널의 `JEV 일치 m/n` 줄은 계열마다 사람 판정에 대해 `crosscheckRateOf`로 잰 값이고, `replay` mark도 센다(판정 계열의 입력에는 판정이 들어가지 않는다). ATFM 자동 판정은 뺀다. mark는 초안 상태를 바꾸지 않고, 20건·80% 게이트에도 들지 않는다.

아직 만들지 않음: 다른 계열, 판정 계열 일치율을 S3에 쓰는 것, DISPATCH mark를 어디에든 쓰는 것(아래). 같은 계열이 Stop 때 CAPTAIN의 마지막 메시지도 분류한다(REPORT, [8.8](#88-aircraft-health)).

### DISPATCH 판정 계열 구현 (ATC-88)

같은 계열·스위치·엔진·백오프·1분 3건 한도가 **열린 DISPATCH ASSIGN 제안**(`kind: ASSIGN`, 상태 `proposed`, HELD 포함. `replay`는 SUPERVISOR가 이미 판정한 것)에도 mark를 남긴다. CLASSIFY 초안과 ASSIGN 제안이 한도를 나눠 쓰고 번갈아 뽑아서 한쪽이 굶지 않는다. 그림자 전용이다: planner 가중치, HOLD, 상태·점수 변경이 없고 `proposals.jsonl`에는 쓰지 않는다. mark를 쓰는 것은 판정한 제안이 20건 넘은 뒤 SUPERVISOR가 나중에 정한다.

| 질문 | 종류 | 묻는 것 |
|---|---|---|
| `ready` | Noul | 본문이 시작하기에 충분한가: 무엇을 바꾸고 어떻게 끝났다고 아는가 |
| `prerequisite` | Noul | 본문이 다른 일(FLIGHT, PR, 릴리스, 결정)을 기다린다고 적었나 |
| `same_area` | Score 5단계 | 그 FLIGHT가 AIRCRAFT의 최근 FLIGHT와 얼마나 가까운가. 원래 점수와 0~1 level로 남긴다 |

**나가는 것.** FLIGHT는 ATC-36 허용 목록 그대로다: 제목과 세 칸(목표, 수정 허용 범위, 완료 기준), 칸마다 600자. `rating:SEC`·`Risk:*` FLIGHT나 라벨을 모르는 FLIGHT는 제목만 보내고 본문은 읽지 않는다. `same_area`를 물을 때만 AIRCRAFT의 마지막 LOGBOOK FLIGHT 3개의 **제목**이 더 나가고, 셋이 모두 atc FLIGHT(AIRPORT `ATCC`, AD HOC 없음, 같은 FLIGHT는 한 번만 셈)이고 제목을 모두 알 때만이다. 하나라도 아니면 `same_area`를 묻지 않는다. REGISTRATION, FLIGHT key, 댓글, 점수는 보내지 않는다. 줄마다 `sent`, `withheld`(본문을 뺀 까닭), `recentWithheld`(`same_area`를 묻지 않은 까닭)가 남는다.

**기록.** `judges.jsonl`에 `target: "dispatch"`인 `judge` 줄이 붙는다: 제안 `id`, `flight`, `run`, `engine`, `model`, `judgment`(`ready`·`prerequisite`는 yes 확률, `sameArea`는 `{score, level, confidence}` 또는 `null`), `sent`, `withheld`, `recentWithheld`.

**화면, 쏠림 없이.** `JEV` 칩은 RECENT의 닫힌 제안에만 보이고, 툴팁에 세 답과 보낸 범위, 뺀 까닭이 있다. 열린 카드와 HELD 카드에는 보이지 않는다(수만 센다). 점검 패널에 참고 줄 셋이 더해진다(게이트 기준이 아니다):

| 줄 | 세는 것 |
|---|---|
| `JEV Ready = no → 거절` | SUPERVISOR가 판정한 제안 중 Ready = no mark 가운데 거절(disagree, reject)이었던 것 |
| `JEV Prerequisite = yes → 선행 대기` | 판정했거나 HELD였던 제안 중 Prerequisite = yes mark 가운데 `waiting-on-prior` 칩이 달렸거나 OCC HOLD였던 것(선행 FLIGHT가 있는 HOLD, 또는 PREFLIGHT mark 없이 건 HOLD. SUPERVISOR가 대기열로 돌린 HOLD는 OCC의 것으로 더 알아볼 수 없다) |
| `JEV Same area 가까움 → 승인` | 판정한 제안 중 `same_area` level이 50% 이상인 mark 가운데 승인(agree, approve)이었던 것 |

## 7. TARGETS

AIRCRAFT마다 SUPERVISOR가 FLEET 탭에서 정한다. 보여 주기만 하고 점수에 넣지 않는다. atc는 이것으로 AIRCRAFT 순위를 매기지 않고, planner도 읽지 않는다.

| 목표 | 재는 곳 |
|---|---|
| 주당 FLIGHT | 이번 주(월요일 00:00 로컬 시각부터 지금까지) ARRIVED한 LOGBOOK 항목 |
| 정시율 | 최근 14일 LOGBOOK 항목에서 팀 block time(시작부터 PR 열기까지)이 7.2의 예상 안에 든 비율. 리뷰·머지 대기는 착륙 대기(landing wait)로 따로 보인다 |
| 되돌린 작업 | 최근 14일 LOGBOOK 항목 중 `reverted`로 표시된 것(`Revert "…"` PR이 머지됨). 다시 열린 FLIGHT는 아직 세지 않는다 |
| 충돌 | FLIGHT를 나는 동안 그 STAND에서 난 LOS. 최근 14일 LOGBOOK 항목을 합한다 |
| FLIGHT당 FUEL(`fuelPerFlight`, USD, 선택) | 최근 14일 값이 매겨진 LOGBOOK 항목의 NET FUEL COST 평균이 목표 이하([fuel.md](fuel.md) 8.6, ATC-56) |
| CACHE HIT(`cacheHit`, 0–1, 선택) | 최근 14일 `fuel`이 있는 LOGBOOK 항목의 CACHE HIT(CAPTAIN + CREW)이 목표 이상 |

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
| `aircraft` | 그 FLIGHT를 난 팀 세션의 REGISTRATION(아래), 정식 표기(`TEAM_G`, ATC-67. 옛 줄은 적힌 대로 대문자). atc가 알 수 없으면 `null`이고, 그래도 줄은 적는다 |
| `flight` | PR 브랜치(`voc-<n>`)나 제목 끝 `(VOC-n)`에서 얻은 ticket key. AD HOC 작업은 `null` |
| `class` | 도착 시점 그 FLIGHT의 Linear 라벨로 본 `classOf(labels)`(FLIGHT TYPE, WAKE, rating, 그리고 type·wake가 라벨에서 왔는지). AD HOC이거나 Linear가 티켓을 모르면 `null` |
| `airport` | 저장소의 AIRPORT code |
| `pr` | `{repo, number, url, title}`. STAND 없는 FLIGHT 줄에는 없고 `standFree`가 있다(5.1.1, ATC-72) |
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
| 최근 | 마지막 5개 항목: 팀 block time(또는 `—`), `+` 착륙 대기, ON TIME / DELAYED. 그 아래 줄에 FUEL: NET(값이 없으면 토큰), LEAK, TRIP FUEL과 비교한 `TRIP ✓`·`UNEXPECTED`. `fuel`이 없는 줄은 `FUEL —` |
| FUEL(ATC-56) | 최근 14일 항목으로 센 `fuelBurn`: 값을 매긴 FLIGHT당 FUEL COST와 NET, CACHE HIT(CAPTAIN, CREW), FUEL COST 중 CREW 몫, 가장 큰 LEAK 규칙 셋, CREW 경고 수(F7), 값 없는 모델, TRIP FUEL p90을 넘은 FLIGHT 수. 근거가 없는 값은 0이 아니라 `—`. FLEET 줄에는 F6 FUEL REMAINING 옆 FUEL 칸에 `$6.10/FLT · CACHE 93%` |

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
| `readback` | D-xxxx 없이 직접 배정된 STAND 없는 FLIGHT를 팀이 READBACK함(5.1.1, ATC-72). `stand`·`branch`는 `null`이고, STAND·PR 맞추기는 이 줄을 보지 않는다 | READBACK | 그 AIRCRAFT |

- main 체크아웃과 `TEAM_X`가 아닌 세션은 무시한다. `flight`는 브랜치의 ticket key이고, AD HOC은 `null`.
- LOSS OF SEPARATION 동안에는 두 세션 모두 활성이므로 기록된 AIRCRAFT가 그대로 남는다. 먼저 있던 쪽이 놓으면 HANDOFF를 쓴다.
- 서버는 시작할 때 파일을 접어 STAND별 마지막 AIRCRAFT를 되살린다. 그래서 재시작해도 두 번 쓰지 않는다. 첫 warm 스냅숏이 기준선이다. 이미 있는 워크트리는 팀이 쥐고 있으면 `claim` 줄을 받지만 `stand` 줄은 받지 않는다.

## 8. FLEET 탭

- 기본은 운항 상태 목록(ATC-44, UI report #99). AIRCRAFT 한 대가 한 줄이다. 열은 callsign과 REGISTRATION, AIRPORT, 상태(AIRBORNE·HOLDING·PARKED·AOG·NORDO·NOT IN SERVICE), 첫 FLYING FLIGHT와 제목(더 있으면 `+N`), STAND를 잡은 뒤 흐른 시간, 세션 마지막 활동, 이번 주 ARRIVED와 정시율. 순서는 AIRBORNE → HOLDING → PARKED, 그다음 AIRPORT 순(순수 함수 `fleetRows`, `server/fleet-status.ts`). 줄을 누르면 그 아래에 AIRCRAFT의 카드가 펼쳐진다. 목록·카드 스위치로 모든 카드를 펼친 보기로 돌아갈 수 있고, 고른 보기는 `localStorage`(`atc.fleet.layout`, 못 쓰면 목록)에 기억한다. 좁은 화면에서는 한 줄이 두 줄로 접힌다.
- AIRCRAFT마다 카드 하나: REGISTRATION과 callsign, 기지 AIRPORT, 상태, 선언한 CREW COMPLEMENT 대 관찰한 CREW, TYPE RATING, ROUTES, LOGBOOK 실적 대 TARGETS(7.2)와 최근 FLIGHT 몇 개.
- LANGUAGE 줄(ATC-150, 표시 전용): CAPTAIN이 SUPERVISOR가 읽는 글에 가나(U+3040–U+30FF)를 쓰면 카드에 "LANGUAGE 일본어로 씀 — CREW BRIEFING 다시 보내기"가 뜨고, FLIGHT FOLLOWING에도 그 AIRCRAFT의 FLIGHT에 같은 참고 항목("TEAM_E가 일본어로 씀 — CREW BRIEFING 다시 보내기")이 뜬다. `kanaAtOf`(`server/judges/report.ts`, 순수 함수)가 AIRCRAFT health와 같은 대화 기록 끝 64KB를 읽고(새로 훑지 않는다), 본 대화(sidechain 아님)의 assistant 글 중 코드 펜스·인라인 코드·`>` 인용 밖만 본다. 세션당 한 번만 낸다(서버가 도는 동안 처음 본 것을 기억한다). 세션에는 아무것도 보내지 않는다. CREW BRIEFING은 SUPERVISOR가 다시 보낸다.
- AIRCRAFT의 세션에서 [rules-drift hook](../hooks/README.ko.md#rules-drift-hook)이 돌면 RULES 줄(ATC-42): "RULES current", 또는 살아 있는 세션이 아직 확인하지 않은 규칙 파일과 "RULES 미확인 since <시각>". 그 세션은 다음 턴에 diff를 받는다.
- SUPERVISOR용 수정 양식(`fleet.json`을 씀, AIRPORT 등록부와 같은 방식).
- DISPATCH 카드마다 제목 아래 분류(5장). 아직 만들지 않음: FIDS의 분류 표시.

### 8.1 팀 꾸리기

FLEET 탭은 팀을 만들고 내리는 곳이기도 하다. 2026-09-28 전까지 atc는 Claude 세션을 스스로 띄우지 않고 붙여 넣을 브리핑까지만 만들었다. 이제 SUPERVISOR가 LAUNCH·STOP을 누르면 백그라운드 세션을 띄우고 멈춘다(8.5). 브리핑은 새 세션이 처음 받는 지시가 된다.

| 동작 | 용어 | 하는 일 |
|---|---|---|
| 팀 더하기 | **ENTRY INTO SERVICE** | REGISTRATION(다음 빈 `TEAM_X`를 제안), 기지 AIRPORT(기본은 팀 세션이 가장 많은 곳), **CONFIGURATION**. 그 이름의 세션이 나타날 때까지 AIRCRAFT는 NOT IN SERVICE로 보이고, 나타나면 atc가 이름으로 잇는다 |
| 팀 템플릿 | **CONFIGURATION** | `general`(vocado 기본 CREW. 기본값을 따른다), `security`(Opus backend + Codex 리뷰. SEC, DATA, DOCS), `ui`(Opus backend + `ui-builder` + `ui-qa`. UI, DOCS), `research`(Opus backend + `flash-helper`. DATA, DOCS) |
| 세션 시작 | **CREW BRIEFING** | 복사할 수 있는 시작 문구: 세션 이름과 폴더, 만들 CREW와 그 모델, TYPE RATING(SEC 규칙 포함), ROUTE, 언어 줄(SUPERVISOR가 읽는 글은 한국어, 일본어·중국어는 쓰지 않는다. 세션끼리 주고받는 글은 영어, ATC-150), 교신 규칙(`tail:` 라벨, `READBACK C-xxxx`. `READBACK D-xxxx`는 승인 운용에서만). 사용자가 그 저장소에서 세션을 열고 이름을 붙인 뒤 붙여 넣는다. 문구는 영어이고(ATC-126), 돌고 있는 세션은 다시 LAUNCH하기 전까지 처음 받은 CREW BRIEFING을 그대로 갖는다 |
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

**어느 세션인가.** 이름이 그 REGISTRATION으로 읽히는 세션(`Team G`도 `TEAM_G`, ATC-67)이 그 AIRCRAFT의 것이다. 스냅숏의 살아 있는 Claude 세션(지금 atc가 AIRCRAFT를 잇는 방식)이거나, `custom-title.json`이 그렇게 말하고 창 안에서 활동한 세션 폴더다. 하나도 없으면 `observedCrew`와 `crewDrift`는 `null`이다(카드에는 "unused"가 아니라 관찰 없음으로 보인다).

**POSITION 대응**(`positionOf`, 선언한 COMPLEMENT 기준):

| 관찰 | POSITION |
|---|---|
| 팀원의 `position`이나 `agent`와 같은 `agentType`(`ui-builder`, `ui-qa`, `flash-helper`, 또는 SUPERVISOR가 agent type으로 선언한 무엇이든) | 그 팀원의 POSITION |
| `model`이 있는 `general-purpose`나 `claude` | `agent`에 그 모델 계열이 든 팀원(`opus` → `claude-opus-5-5` → `backend`). 그런 팀원이 없으면 없음 |
| `model`이 없는 `general-purpose`나 `claude` | FUEL이 그 서브에이전트의 usage 줄을 읽었으면 실제로 답한 모델(ATC-57, [fuel.md](fuel.md) 5장). 그 전에는 Opus로 본다. 호출은 CAPTAIN의 모델을 물려받고, CAPTAIN은 Opus로 돌기 때문이고, `model`은 `null`로 남는다 |
| 내장 에이전트(`Explore`, `Plan`, `claude-code-guide`, `statusline-setup`)와 그 밖의 agent type | 이름으로 선언하지 않았다면 없음 |

호출은 `agentType`과 `model`로 묶는다: `observedCrew: {agentType, position, model, count, lastAt}[]`, 최근 것부터.

**어긋남**(`crewDrift`):

- `undeclared`: POSITION이 없는 관찰된 호출. agent type별이고, 모델이 주어졌거나 보였으면 함께 적는다(`Explore`, `general-purpose (sonnet)`). 카드에는 "선언에 없음: Explore"로 보인다. ATC-57부터는 실제 모델이 그 POSITION이 선언한 모델과 다른 호출(COMPLEMENT DRIFT, [fuel.md](fuel.md) 5장)도 `타입 (실제 모델)`로 여기에 든다.
- `unused`: 창 안에 호출이 없는 선언된 POSITION. 서브에이전트가 아닌 POSITION(`security` CONFIGURATION의 `reviewer` POSITION, agent `codex (GitHub 리뷰)`. GitHub 리뷰로 일한다)은 늘 여기 보인다. 잘못이 아니라 "보지 못함"으로 읽는다.

**비용.** 서버는 `~/.claude/projects`에서 `custom-title.json`을 많아야 30초에 한 번 다시 훑는다. 제목은 파일 mtime으로, 세션별 호출은 `subagents/` 폴더의 mtime으로 캐시한다. 그래서 바뀌지 않은 세션은 다시 읽지 않는다.

**빈틈: agent team 팀원.** CAPTAIN이 Agent 도구로 띄운 팀원(이름이 있든 없든, 백그라운드든 아니든)은 CAPTAIN의 `subagents/` 아래 기록되므로 관찰된다. Claude Code agent team의 팀원 중 별도 세션으로 도는 것(`~/.claude/teams/<team>/` 아래 등록)은 관찰되지 않는다. atc는 팀 설정을 읽지 않고, 그 세션들은 자기 이름을 갖기 때문이다. 선언돼 있으면 `unused`로 보인다. 이들을 보려면 리더 세션을 알려 주는 메타데이터 출처가 필요한데, 아직 쓰는 것이 없다.

### 8.4 CREW CHANGE

SUPERVISOR가 운항 중인 AIRCRAFT의 CREW COMPLEMENT를 `PATCH /api/fleet/:registration`으로 바꾸면 atc가 CREW CHANGE를 쓴다. CAPTAIN에게 줄 문구로, CREW BRIEFING과 비슷하지만 이미 돌고 있는 팀용이다. CREW BRIEFING처럼 영어이지만(ATC-126), FLEET 탭에도 보이는 `ratingImpact` 줄은 한국어 그대로다. `server/crew-change.ts`에 있고, `fleet.ts`에 걸린 것은 프로필 저장 뒤의 호출 하나뿐이다. 1단계(아래 앞부분)는 문구와 SUPERVISOR의 손 전달이다. 2단계(나머지)는 DISPATCH approval 모드(2b)에서 OCC가 보내게 한다.

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

**2b 점검표.** `crew-change` 항목("CREW CHANGE 발부", `selfCheckCrewChange`)은 이 전이, 거절, 메시지, 늦음 규칙, 엔드포인트, `atcctl` 명령을 코드 사실로 확인한다. `readback-*` 항목(`candidateTeams`가 배정할 수 있는 AIRPORT마다 하나, `vocado-readback` 포함)은 그 AIRPORT의 `CLAUDE.md`가 `[OCC CC-xxxx]`에도 `READBACK CC-xxxx`로 답할 때만 준비됨이다([dispatch.ko.md](dispatch.ko.md) "2b 켜기 점검표").

### 8.5 세션 조종: LAUNCH와 STOP

2026-09-28에 결정을 바꿨다(SUPERVISOR). atc가 AIRCRAFT 세션을 직접 띄우고 멈춘다. SUPERVISOR는 세션을 하나씩 손으로 열지 않고 FLEET 탭에서 FLEET를 굴린다. 직접 연 세션에 CREW BRIEFING을 붙여 넣는 길도 그대로이고, atc는 전처럼 이름으로 잇는다.

- **방식.** Claude Code 백그라운드 세션. LAUNCH는 base AIRPORT의 본 체크아웃에서 `claude --bg -n <REG> --permission-mode <mode> [--model <model>] "<CREW BRIEFING>"`을 돌린다. `claude agents --json`이 살아 있는 세션(데스크톱·터미널·백그라운드)을 보여 준다. STOP은 `claude stop <id>`다. 대화는 남고 `claude attach <id>`나 `claude --resume`으로 다시 연다. 세션은 `~/.claude/sessions/`에 `kind: "bg"`로 나타나서 RADAR·STRIPS·planner가 다른 세션처럼 본다.
- **API**(`server/session-control.ts`): `GET /api/fleet/sessions`는 이름이 `teamPattern`에 맞는 세션으로 `{max, permissionModes, sessions}`를 돌려준다. `POST /api/fleet/:registration/launch`는 `{permissionMode?, model?}`를 받는다. `POST /api/fleet/:registration/stop`.
- **SUPERVISOR만.** LAUNCH와 STOP은 이 화면의 Origin이 있어야 받는다(`fromThisApp`, AUTOLAND 스위치와 같음). `atcctl`은 Origin을 보내지 않으므로 TOWER·OCC·REVIEW는 세션을 띄우거나 멈출 수 없다.
- **거절**(`launchPlanOf`, `stopTargetOf`, 순수 함수): RETIRED, base AIRPORT 없음, 그 이름의 세션이 이미 떠 있음(종류 상관없음), 백그라운드 세션이 이미 `ATC_MAX_LAUNCHED`개(기본 6, 이 머신의 백그라운드 세션 전부를 셈), permission mode가 `auto`·`acceptEdits`·`default`가 아님(`bypassPermissions`는 주지 않는다), 모델 이름에 `[\w.:[\]-]` 밖의 글자. STOP은 데스크톱·터미널 세션을 거절한다. 그 창에서 닫는다.
- **서비스 밖에서.** LAUNCH는 `systemd-run --user --scope --collect`(임시 `atc-claude-<ms>.scope`)로 `claude`를 부른다. 이 기계에서 처음 부른 `claude --bg`가 모든 백그라운드 세션을 맡는 daemon(`claude daemon run`)을 띄우는데, atc 안에서 띄우면 daemon이 `atc.service` cgroup에 들어가 `KillMode=control-group` 때문에 `systemctl restart atc`마다 모든 백그라운드 세션이 죽었다(2026-09-28: 배포 때 OCC `a578bf15`가 `failed`로 끝남). scope에는 `-p OOMPolicy=continue`를 준다. systemd 기본값 `stop`이면 scope 안의 프로세스 하나가 OOM으로 죽을 때(팀 세션이 돌린 테스트 등) scope 전체가 멈춰 daemon과 모든 백그라운드 세션이 같이 끝난다(2026-09-30 08:54Z: 12개). `continue`면 그 프로세스만 죽는다. `ATC_BG_SCOPE=off`면 바로 부른다. `GET /api/control/sessions`가 `daemonInService`를 알리고, daemon이 아직 서비스 안에 있으면 CONTROL 블록이 경고한다.
- **환경.** 세션은 atc 서비스의 환경이 아니라 깨끗한 환경(HOME, USER, 로캘, XDG runtime, claude CLI와 node가 든 PATH)을 받는다. `.env.local`의 비밀(Linear, TypeSafe)이 세션에 가지 않는다. CLI 경로는 `ATC_CLAUDE_BIN`(기본 `~/.local/bin/claude`. 서비스 PATH에 없다).
- **폴더 신뢰.** Claude Code는 trust 질문을 수락하지 않은 폴더에서 백그라운드 세션을 거절한다. atc는 그 사실을 알리고 trust 설정은 건드리지 않는다. 그 저장소에서 `claude`를 한 번 열어 수락한다.
- **브리핑의 STAND 규칙(ATC-252).** LAUNCH가 넘기는 CREW BRIEFING(붙여 넣는 것은 아님)에는 AIRPORT와 상관없이 같은 STAND 문단이 들어간다. STAND는 `EnterWorktree name=<key>-<짧은 이름>`으로 열고(`<repo>/.claude/worktrees/`, 브랜치 `worktree-…`), `cp -al <repo>/node_modules <stand>/node_modules`, 다음 FLIGHT 전에 `ExitWorktree action=keep`, `.claude/worktrees/` 밖의 `EnterWorktree path=`는 쓰지 않는다(승인을 물어 백그라운드 세션이 멈춘다). 다른 워크트리 폴더를 정한 저장소 규칙보다 앞선다. 그래도 멈추면 need가 "Entering worktree"와 맞을 때 NEEDS YOU 줄에 "STAND outside .claude/worktrees — attach and approve; see CREW BRIEFING"이 붙는다(`server/stand-hint.ts`).
- **기록.** LAUNCH·STOP마다 FLIGHT RECORDER에 `{kind: "fleet", op: "launch" | "stop", aircraft, by: "SUPERVISOR", ok, jobId, cwd, permissionMode, model, error}` 한 줄.
- **FLIGHT와 함께 LAUNCH(ATC-73).** 세션이 없는 카드의 ▾ 옵션 블록에 FLIGHT 칸(선택)이 있다. 적으면 `POST /api/fleet/:registration/launch`가 `flight`를 받고, 첫 프롬프트가 CREW BRIEFING에 이어 DIRECT 지시서(`GET /api/dispatch/flight/<FLIGHT>/brief?to=<REG>`, `directBriefOf`)다. 지시서를 읽지 못하면 띄우지 않는다(502). `launchPlanOf`의 거절과 상한은 그대로다. FLIGHT RECORDER `fleet` `launch` 줄에 `flight`가 남는다.
- **화면.** 세션이 없는 카드에 **LAUNCH**(permission mode, 선택 모델, 상한 대비 백그라운드 수). 살아 있는 세션마다 출처(`BG`·`DESKTOP`·`TERM`)와 permission mode(8.5.2), 백그라운드 세션이면 **STOP**도. 백그라운드 세션을 모는 AIRCRAFT를 퇴역시키면 세션도 멈출지 묻는다.

아직 만들지 않음: 쉬는 세션의 자동 STOP(FLEET PLAN 4단계. 그림자 제안과 승인 운용은 8.6·8.7에서 만듦), FLIGHT 도중 오래 도는 세션의 정기 정비로서 RESTART(배정이 먼저 온 쉬지 못한 AIRCRAFT는 8.6의 FRESH START, ATC-73)(쉬는 AIRCRAFT는 REFRESH, 8.6, ATC-69), 새 COMPLEMENT로 다시 띄우는 CREW CHANGE, AIRCRAFT별 사용량 예산(FUEL, ATC-46, [fuel.md](fuel.md)).

#### 8.5.1 관제 세션(2026-09-28 만듦)

같은 LAUNCH·STOP이 atc 자신의 관제 세션에도 된다. FLEET 탭의 CONTROL SESSIONS 구역(ATC-130)에서 누르므로, SUPERVISOR가 세션마다 tmux 창을 열지 않는다. 줄마다 live 배지가 있다(ATC-66).

| 세션 | 폴더 | 방식 | 첫 메시지 | 추가 옵션 |
|---|---|---|---|---|
| TOWER | `controller/` | `claude --bg` | `/loop 3m /tick` | |
| OCC | `occ/` | `claude --bg` | `/loop 10m /tick` | |
| MCC | `mcc/` | `claude --bg` | `/loop 5m /tick` | `--strict-mcp-config` |
| REVIEW | `review/` | `claude --bg` | `/loop 10m /tick` | `--strict-mcp-config` |
| ENGINEERING | 저장소 뿌리 | 배지만 | | |

- **배지.** `BG <id>`(백그라운드 세션), `tmux <세션>`(tmux pane에서 도는 세션), `interactive`(Claude Desktop 등 다른 곳에서 연 세션), `not running`. 2026-09-28에 CROSSCHECK가 꺼져 있었는데 화면 어디에도 보이지 않아서 더했다.

- **방식.** atc 저장소의 그 폴더에서 `claude --bg -n <이름> --permission-mode auto [옵션] "<첫 메시지>"`, 환경은 8.5와 같이 깨끗하게. 폴더의 `.claude/settings.json`(모델, 허용 목록, fail-closed guard)이 그대로 걸린다. 백그라운드 세션은 권한 창에 답할 수 없으므로 `auto`로 고정하고, 막는 일은 guard가 한다. 2026-09-28에 백그라운드 MCC로 확인했다: `/loop`이 `/tick`을 걸었고, guard hook이 돌았고, `atcctl manual check`와 `mcc queue`가 권한 창 없이 돌았다.
- **이미 떠 있음.** 이름이 같거나 그 폴더에서 연 세션을 그 관제 세션으로 본다(이름 없이 tmux로 연 `mcc-b4` 같은 세션도 폴더로 알아본다). 하나라도 떠 있으면 LAUNCH를 거절해, 두 벌이 같은 일을 하지 않게 한다. STOP은 백그라운드 세션이면 `claude stop`으로, tmux pane에서 도는 세션이면(그 pid나 조상이 pane의 첫 프로세스, `tmux list-panes -a`와 `/proc/<pid>/stat`로 찾는다) 그 pane만 `tmux kill-pane`으로 닫는다. tmux 세션의 다른 창은 그대로다. tmux pane을 닫기 전에 화면이 묻는다. 어느 쪽이든 대화는 남는다(`claude --resume`). 데스크톱(Claude 앱) 세션은 그 창에서 닫는다.
- **CROSSCHECK는 은퇴했다**(ATC-371). 더 띄우거나 살려 두거나 재시작하지 않고, 위 표와 CONTROL BULK에 줄이 없다. 이 변경이 들어갈 때 아직 떠 있는 CROSSCHECK 세션은 서버가 한 번 멈춘다(`retired-stop`, SUPERVISOR 단계 없음). 옛 mark는 기록으로 읽힌다.
- **CROSSCHECK·REVIEW**(ATC-66, 2026-09-29에 바뀜. CROSSCHECK는 ATC-371로 은퇴). 2026-09-29까지는 `ocx claude`로 다른 계열 모델에 돌렸고, `claude --bg`로는 그렇게 할 수 없어서 LAUNCH가 tmux 세션(`atc-crosscheck`, `atc-review`)을 열었다. 그 뒤로 CROSSCHECK는 Claude Opus, REVIEW는 Claude Sonnet으로 돌고, TOWER·OCC·MCC처럼 `claude --bg`로 연다([occ.ko.md](occ.ko.md) 9.9와 "CROSSCHECK를 Claude Opus로"). tmux와 `ocx`로 띄우는 코드는 없앴다. tmux pane에서 도는 관제 세션은 STOP이 여전히 알아보고 그 pane만 닫는다.
- **ENGINEERING**은 저장소 뿌리에서 여는 작업 세션인데 팀 세션도 거기서 돌므로, 이름으로만 알아보고 LAUNCH·STOP이 없다.
- **상한.** 관제 세션은 팀 세션 상한 `ATC_MAX_LAUNCHED`에 세지 않는다.
- **STALE 줄, 만든 대로(2026-09-29, ATC-93).** Claude Code 2.1.284는 `done`일 때 멈춘 job을 목록에 계속 둘 수 있다. 2026-09-29에 TOWER job `3bf04645`가 `pid`·`status` 없이 `"state": "working"`으로 한 시간 넘게 `claude agents --json`에 남았다. 그 줄이 TOWER LAUNCH를 막고, 살아 있는 세션으로 셌다.
  - **규칙**(`isStaleRow`): `background`이고, `pid`·`status`가 없고, job 파일 `~/.claude/jobs/<id>/state.json`의 `state`가 `done`·`stopped`·`failed`이고, `startedAt`이 2분 넘게 지났으면 STALE이다.
    - `agentRows()`는 `pid`·`status`가 없는 줄에서만 그 한 칸을 읽는다. `~/.claude/jobs/` 아래에는 쓰지 않는다.
    - 살아 있는 background 줄은 쉬든 일하든 늘 `pid`가 있다.
    - 막 띄운 job은 0.4초쯤 `pid`·`status` 없이 보이지만 그때 state는 끝난 값이 아니다(2026-09-29 확인).
    - 살아 있는 job도 턴을 마칠 때마다 state가 `done`이라 state만으로는 가르지 않는다.
    - job 파일을 못 읽으면 STALE이 아니다.
  - **효과**: STALE 줄은 어디서도 살아 있는 세션이 아니다.
    - `controlRowsOf`·`refuseLive`, 팀 `launchPlanOf`, `ATC_MAX_LAUNCHED` 계산이 뺀다.
    - FLEET PLAN 입력과 RESTART 대기도 뺀다(`liveRowsOf`).
    - STALE만 있는 세션에 STOP하면 이유와 함께 409이고, `claude stop`을 다시 하지 않는다.
  - **화면**: `GET /api/control/sessions`는 관제 세션마다 `stale: [{id, name}]`를, `GET /api/fleet/sessions`는 줄에 `stale: true`를 준다. CONTROL 블록과 FLEET 카드는 `STALE <id>`와 "Claude Code가 멈춘 job을 아직 목록에 둠 — 무시해도 된다"를 보이고, LAUNCH는 그대로 쓸 수 있다.
- **API**(`server/session-control.ts`): `GET /api/control/sessions`(`{daemonInService, sessions: [{name, dir, prompt, launch: "bg" | null, blocked, live}], accounts}`), `POST /api/control/:name/launch`, `POST /api/control/:name/stop`. 둘 다 SUPERVISOR만(이 화면 Origin). 순수 함수: `controlLaunchPlanOf`, `launchBlockOf`, `controlStopTargetOf`, `controlRowsOf`, `isControlRow`.
- **기록.** FLIGHT RECORDER `{kind: "control", op: "launch" | "stop", session, by: "SUPERVISOR", ok, jobId, tmux, cwd, permissionMode, error}`(`permissionMode`는 ATC-76부터). 백그라운드 세션이면 `jobId`, tmux 세션이면 `tmux`(launch는 세션, stop은 `<세션> <pane>`).

##### FLEET 탭의 CONTROL SESSIONS as built (ATC-130)

- **옮겼을 뿐 바꾸지 않았다.** 설정 창 AGENTS 탭의 블록을 FLEET의 `CONTROL SESSIONS` 구역(AIRCRAFT 목록 아래)으로 옮겼다. 보이는 것은 같다: LAUNCH·STOP(같은 tmux 확인), 배지, job 상태와 NEEDS YOU, STALE 줄, ACCOUNT 라벨, daemon 경고, 모델 안내. API와 `session-control.ts`는 그대로이고, LAUNCH·STOP은 SUPERVISOR 전용이다.
- **순서.** daemon이 서비스 안에서 돈다는 경고가 구역의 첫 줄이다(줄들 위).
- **새로 읽기.** FLEET가 보이는 동안 `GET /api/control/sessions`를 1분에 한 번까지 다시 읽고(브라우저 탭이 숨겨져 있으면 건너뜀), LAUNCH·STOP 직후에는 곧장 읽는다. 1분 안에 탭을 다시 열면 API를 부르지 않고 마지막에 읽은 값을 보인다. 서버가 `claude agents`를 캐시하든 말든 화면은 60초보다 자주 읽지 않는다.
- **안내.** 설정 AGENTS 탭에는 `#fleet/control`로 가는 한 줄만 남는다. ATC-445부터 그 주소는 화면 아래 CONTROL 패널을 연다(FLEET 화면에서). CONTROL 그룹은 FLEET에 없고 헤더 띠는 패널의 머리가 됐다(docs/layout.md "Z5 as built").
- **헤더 CONTROL 띠 as built(ATC-127).** `web/src/ControlStrip.tsx`(ATC-116이 다른 헤더 막대와 합치기 쉽게 따로 둔 컴포넌트)가 탭 줄 아래에 관제 세션마다 칩 하나를 그린다: `TWR OCC MCC XCHK REV ENG`, 예 `MCC ● 5m · 2분 전`. 규칙은 브라우저에서도 도는 순수 함수 하나, `server/control-strip.ts`의 `controlStripOf`: `down`(live 줄이 없거나 이름이 같은 세션이 모두 죽음), `needs`(job `blocked`, `needs`가 있음, health가 `alert` 수준), `late`(마지막 tick이 2 × 주기 + 1분보다 오래됨. 주기는 첫 메시지의 `/loop <n>m`이고, 없으면 늦다고 하지 않는다), `working`(job `working`), 그 밖은 `ok`. ENGINEERING은 떠 있는지만 보인다. 마지막 tick은 SQUELCH 기록이 있으면 그 판정 시각이고, 없을 때만 세션의 `lastActiveAt`이다(툴팁에 적힌다). 클릭은 `#fleet/control`(상수 하나, `CONTROL_TARGET`). 768px 아래는 `CTRL n/6` 한 칩으로 접힌다. 보기만 한다: LAUNCH·STOP도 새 경보 종류도 없다. `down`·`late` 관제 세션이 ALERT를 올려야 하는지(그리고 ATC-110의 어느 등급인지)는 후속이다.
- **띠의 데이터(ATC-127).** `GET /api/control/sessions`가 새 엔드포인트 대신 세션마다 `squelch`를 싣는다(`squelch.jsonl` 꼬리의 마지막 판정 시각, `squelch.json`의 `openedAt`·`quietSince`·`quietCount`. 읽기만 하고 기록이 없으면 `null`). 서버는 `claude agents --json`을 30초 캐시하고(`server/agents-cache.ts`) 띠와 FLEET 구역이 나눠 쓴다. `?fresh=1`은 캐시를 건너뛰고, FLEET 구역은 LAUNCH·STOP 뒤에 그것을 보낸다. LAUNCH·STOP의 판단은 여전히 `agentRows()`를 새로 읽는다. 브라우저는 이 엔드포인트를 1분에 한 번까지 읽고, 띠와 구역이 마지막 값(`web/src/controlData.ts`)을 나눠 쓰되 60초 시계는 각자 가진다(구역은 ACCOUNT 라벨도 읽는다). 옛 서버(`squelch`·`job` 없음)도 있는 것으로 그린다.
- **코드.** `web/src/views/fleet/ControlSessions.tsx`가 그린다. 줄 계산(배지, 색, 어느 버튼, NEEDS YOU, STALE)과 60초 규칙은 `server/control-view.ts`의 순수 함수이고 `server/control-view.test.ts`가 시험한다.

##### CONTROL 그룹 as built (ATC-132)

- **AIRCRAFT와 같은 줄.** CONTROL SESSIONS는 이제 같은 목록의 둘째 그룹이다(AIRCRAFT 줄 아래, 그룹 머리 줄 `CONTROL 6`). 카드 덩어리가 아니다. 줄의 틀을 AIRCRAFT 목록과 나눠 쓰므로(`StatusList.tsx`의 `FleetRowShell`) 같은 열에 맞는다: 이름(역할과 폴더. 폴더가 이름의 소문자일 뿐이면 뺀다), AIRPORT `ATCC`, STATUS(`BUSY`·`IDLE`·`NEEDS YOU`·`NOT RUNNING`, 색은 AIRBORNE·HOLDING·호박색·NOT IN SERVICE), FLYING(job의 `detail`이나 NEEDS YOU 칩), 경과(loop 주기 `3m`), 마지막 활동, FOB, FUEL 14일. 이번 주 칸은 비운다. 목록 보기에서는 목록 아래에 이어 붙고, 카드 보기에서는 자기 열 이름 줄을 달고 따로 선다.
- **펼침(▸, Enter·Space도 된다).** STOP이나 LAUNCH(같은 tmux 확인, 여전히 SUPERVISOR 전용), 폴더와 첫 메시지, 조용한 `STALE n` 칩(툴팁: id와 "Claude Code가 멈춘 job을 목록에 남긴 것, 무시해도 됨". 호박색이 아니고 접힌 줄에는 없다), ACCOUNT 편집(`PUT /api/control/:name/account`, 전과 같다). NEEDS YOU인 줄은 펼친 채 시작하고, SUPERVISOR가 접으면 접힌 채로 둔다.
- **공통 사실은 한 번.** 그룹 머리에 모든 세션이 같은 것을 적는다: `CONTROL 6 · claude --bg · auto · acct-2 · model: TOWER·OCC Sonnet, MCC Opus`. 공통 값은 가장 흔한 값이고, 줄은 그것과 다를 때만 칩을 보인다(ACCOUNT, `tmux에서 연 세션` 같은 띄운 방식, BG·TERM 칩의 permission mode). 모델은 각 세션이 최근 14일에 실제로 쓴 것(`/api/fuel`)에서 오고, 아직 기록이 없으면 폴더 설정 안내로 대신한다. daemon 경고는 그룹 맨 위에 그대로 있다.
- **origin 칩.** ATC-98이 AIRCRAFT 줄에 붙인 것과 같은 `fl-origin` 칩: `BG`(툴팁에 job id), tmux pane이면 `TERM`, 데스크톱 세션이면 `DESKTOP`.
- **데이터.** 새로 읽기는 ATC-130 그대로다(`/api/control/sessions`는 1분에 한 번까지). 마지막 활동·origin·permission mode는 snapshot에서, FOB와 14일 FUEL COST는 그룹을 열 때 `GET /api/fuel?days=14`를 한 번 읽어(60초 동안 재사용) 얻는다. 새로 도는 것은 없다. FUEL 기록이나 context가 없는 세션은 0이 아니라 `—`이다. API는 바뀌지 않았다.
- **ACCOUNT 보기는 하나.** AIRCRAFT 목록 아래 FUEL ACCOUNT 블록이 FLEET의 유일한 ACCOUNT 보기다. `hold` 수준이 하는 일(`LAUNCH·ENTRY 제안 안 함`, FLEET PLAN이 싣던 효과 글)도 이제 여기에 있다. FLEET PLAN의 ACCOUNT 줄은 없앴고, FLEET 응답에 `fuelAccounts`가 없는 옛 서버일 때만 다시 보인다.
- **코드.** 줄 모델, 그룹 사실(공통 값과 줄별 다름 표시), 상태 규칙, ACCOUNT 보기 선택은 `server/control-view.ts`의 순수 함수(`controlRow2Of`, `controlGroupOf`, `controlGroupFacts`, `accountViewOf`)이고 `server/control-view.test.ts`가 시험한다. `web/src/views/fleet/ControlSessions.tsx`가 그린다.

#### 8.5.2 세션 출처 as built (ATC-76)

`claude agents --json`은 `background`인지 `interactive`인지만 알려 준다. 2026-09-28에 interactive 팀 세션 10개가 모두 데스크톱 세션이었다. 이 차이는 조종(atc는 백그라운드 세션만 멈추고 다시 띄운다), 계정(백그라운드는 호스트 CLI 로그인, 데스크톱은 앱의 계정), 수명(데스크톱 세션은 앱 연결에 달림), 2b 전달(permission mode가 다른 세션은 cross-session 메시지를 사용자 승인까지 붙들 수 있다)에 모두 걸렸다.

- **출처**(`server/session-origin.ts`의 순수 함수 `originOf`): 세션 파일의 `kind`가 `bg`이거나 `claude agents` 줄의 `kind`가 `background`면 `background`. 아니면 프로세스 명령줄로 정한다. pid와 시작 시각마다 한 번 `/proc/<pid>/cmdline`과 부모의 것을 읽는다(`server/session-proc.ts`). `~/.claude/remote/` 아래 실행 파일이면 `desktop`(데스크톱 세션은 `~/.claude/remote/srv/<hash>/server` 아래의 `~/.claude/remote/ccd-cli/<버전>`), 그냥 `claude`·`…/bin/claude`·`…/claude/versions/<버전>`이면 `terminal`, 백그라운드 daemon 아래(`bg-spare`, `bg-pty-host`)면 `background`, 그 밖은 `unknown`. 프로세스를 못 읽으면 세션 파일의 `entrypoint: "claude-desktop"`으로 `desktop`을 안다. 읽기만 한다: 신호를 보내거나 붙지 않고, 계정 정보는 읽거나 저장하지 않는다.
- **permission mode**(`permissionModeOf`): 명령줄의 `--permission-mode <m>`이나 `--permission-mode=<m>`. 백그라운드 세션은 명령줄에 없으니 그 세션을 띄운 LAUNCH에서 읽는다. 세션 시작 2분 안의 성공한 FLIGHT RECORDER launch 기록이다(`launchModeOf`). 관제 세션 LAUNCH도 이제 `permissionMode`를 적는다. 그 전 기록은 `controlLaunchPlanOf`가 늘 넘기던 `auto`로 본다. 그 밖에는 모름.
- **API.** 스냅샷의 살아 있는 Claude 세션마다 `origin`과 `permissionMode`가 있다. `GET /api/fleet`은 AIRCRAFT 보기마다 싣고(세션이 없으면 `null`), FLEET 목록 줄에는 `origin` 표시가 붙는다.
- **화면.** 목록 줄과 카드에 `BG`·`DESKTOP`·`TERM`·`?`와 permission mode. `BG <id>` 배지를 대신하고 id는 툴팁에 있다. 세션이 백그라운드가 아닌 카드에는 그 출처의 손 절차가 한 줄 보인다. ACCOUNT 줄에는 BG 세션은 호스트 CLI 로그인을, DESKTOP 세션은 앱의 계정을 따른다는 말이 붙는다(보여 주기만).
- **쓰임.** 카드의 STOP, STOP API(`stopTargetOf`와 `rowOriginOf`), FLEET PLAN 실행(`STOP`, `RESTART`, `REFRESH`, `RETIRE`의 세션 멈춤)은 출처가 `background`일 때만 한다. 다른 출처는 그 출처의 손 절차를 받는다(`manualStepsOf`): Claude 앱에서 닫기, 터미널에서 `/exit`, REFRESH면 `/clear` 뒤 CREW BRIEFING 붙여 넣기. FLEET PLAN의 `session` 사유에 출처가 나오고, 저장된 `value`는 그대로 `interactive`·`background`다.
- **2b 전달.** `GET /api/dispatch/brief`의 `delivery`: 제안 AIRCRAFT마다 출처, permission mode, OCC의 permission mode, 둘 다 알고 다를 때의 `warn`(`deliveryOf`). DISPATCH 카드와 IN FLIGHT 줄에 `MODE <m> ≠ OCC <m>`이 떠 메시지가 붙들릴 수 있음을 알린다. 막지 않는다.
- **jobId가 든 BG 칩(ATC-98).** 목록 줄과 카드의 `BG` 칩은 이미 있었다(ATC-76). ATC-98은 그 칩이 가리키는 id를 더한다: 스냅샷의 `Session`이 세션 파일에서 `kind?: "background" | "interactive"`와 `jobId?`를 읽는다(`server/sources/claude.ts`의 순수 함수 `sessionKindOf`. `kind`가 없거나 모르는 값이면, 옛 스냅샷이나 Codex 세션이면 둘 다 없다). `AircraftView`와 `FleetRow`는 AIRCRAFT의 *살아 있는* 세션에서 `background: { jobId: string | null } | null`을 싣는다. 스냅샷만으로 셈하므로(`liveViewOf`) `claude agents`를 더 부르지 않는다. 칩 툴팁은 `BG <jobId> — claude attach <jobId>`이고, 카드에 `claude attach <jobId>`를 복사하는 `ATTACH 복사` 버튼이 있다. 죽은 세션, STALE job(ATC-93), 세션 없는 AIRCRAFT는 `background: null`이라 칩이 없다. `jobId`를 못 읽은 background 세션은 칩은 있고 attach 명령은 없다.

#### 8.5.3 그 밖의 백그라운드 세션 as built (ATC-184)

`ATC_MAX_LAUNCHED`는 관제 세션과 STALE을 뺀 살아 있는 백그라운드 세션을 모두 센다. AIRCRAFT도 관제 세션도 아닌 백그라운드 세션(예: 밤샘 ENGINEERING를 `ENGINEERING-NIGHT`로 연 것)도 들어가는데, 지금까지는 자리를 쥐고도 어디에도 보이지 않았다. 상한이 세는 것은 그대로이고, 이제 누가 자리를 쥐었는지를 보인다. STOP 버튼 말고는 읽기만 한다.

- **순수 코드.** `server/other-background.ts`의 `otherBackgroundOf(rows, registry, controlNames)`는 등록된 AIRCRAFT(팀 패턴이거나 `fleet.json`의 REGISTRATION·콜사인, FLEET와 같은 읽기)도 관제 세션(이름이나 관제 폴더에서 연 것)도 아닌 살아 있는 백그라운드 줄을 돌려준다. STALE 줄은 뺀다. 줄마다 `id`, `name`, `cwd`와 `cwdShort`(`~/projects` 기준 상대), `status`, job의 `state`·`detail`·`tempo`, `lastActiveAt`(대화 기록의 마지막 변경, 없으면 job의 `updatedAt`), `idleMin`, `account`. 상한 줄은 `capHoldersOf`·`capHoldersText`가 만든다.
- **API.** `GET /api/control/sessions`에 `others[]`와 `max`가 들어 있다. `GET /api/fleet/sessions`에는 `holders`(글)와 `launched`가 있다.
- **FLEET 탭.** CONTROL 아래 `OTHER BACKGROUND SESSIONS` 그룹: 세션마다 한 줄(이름, id, 폴더, 상태, 논 시간, job detail)과 **STOP** 버튼, 그리고 이 세션들도 `ATC_MAX_LAUNCHED`에 센다는 글. 비면 그룹이 없다. STOP은 먼저 묻고 `POST /api/control/others/:id/stop`을 부른다. CONTROL STOP과 같은 Origin 검사이고, 그 순간 "그 밖"으로 읽히는 id만 멈추며(AIRCRAFT·관제 세션 id는 `404`), FLIGHT RECORDER에 `kind: "other", op: "stop"`으로 남는다. 저절로 멈추는 것은 없다.
- **상한 줄이 자리를 쥔 쪽을 적는다.** `백그라운드 7/7 — AIRCRAFT 6 · 그 밖 1 (ENGINEERING-NIGHT, 6h idle)`. `POST /api/fleet/:reg/launch`의 `409`(`백그라운드 세션 N개 — 상한 N(ATC_MAX_LAUNCHED) · AIRCRAFT n · 그 밖 n (…)`), DISPATCH launch 카드의 `launchFullWhy`, FLEET LAUNCH 패널에 나온다.
- **놀고 있는 자리 힌트.** 상한이 찬 채 DISPATCH launch 카드가 자리를 기다리는 동안 120분 넘게 논 그 밖의 백그라운드 세션이 있으면, 그 세션과 막힌 LAUNCH를 적은 ADVISORY SUPERVISOR 알림 하나(`cap|other|<id>`, 그룹 `recycle`, 링크 `#fleet/control`)가 뜬다. 아무것도 멈추지 않는다.
- **하지 않은 것.** FLEET PLAN의 `blocked` 글은 아직 `백그라운드 세션 N/max — 상한`만 적는다.

#### 8.5.4 CONTROL SESSIONS 일괄 동작 as built (ATC-255)

한 번 확인하면 관제 세션(TOWER, OCC, MCC, REVIEW)을 알려진 좋은 상태로 만든다: 모두 떠 있고, 맞는 ACCOUNT에서, 정해진 순서로. 새로 세션을 띄우거나 멈추는 길은 없다. 동작은 모두 FLEET의 LAUNCH·STOP이나 CONTROL RECYCLE의 재시작과 같은 함수(`launchControl`, `stopControl`, `performRecycle`)다. guard는 바꾸지 않았다.

- **동작 넷.** **LAUNCH ALL**은 떠 있지 않은 세션을 띄운다. **RESTART ALL**은 `claude --bg`로 도는 세션마다 STOP → LAUNCH를 하고 떠 있지 않은 세션은 LAUNCH해서 결과가 "모두 떠 있음"이 되게 한다. **STOP ALL**은 멈춘다. **ALIGN**은 ACCOUNT가 어긋난 세션만 다시 띄운다. 버튼은 CONTROL 그룹 머리 아래에 있고, 누르면 먼저 미리 보기가 열린다.
- **순서.** TOWER, OCC, MCC, REVIEW(CLEARANCE·FLIGHT PLAN 흐름이 먼저, 검증 쪽이 나중), 한 번에 한 세션. STOP ALL은 반대로 REVIEW부터 내린다. LAUNCH·RESTART·ALIGN은 첫 실패에서 멈추고(순서가 있는 일), STOP ALL은 실패해도 나머지를 내린다.
- **intended ACCOUNT.** 지금 LAUNCH하면 쓸 ACCOUNT: 관제 세션의 LAUNCH ACCOUNT, 없으면 `fleet.json`의 그 세션 ACCOUNT 라벨, 없으면 default 폴더. drift는 살아 있는 `claude --bg` 세션의 관찰한 ACCOUNT가 다른 것이다(TOWER는 `acct-3`, intended는 `acct-1`). ACCOUNT 등록부가 없으면 drift도 없다.
- **미리 보기.** `GET /api/control/bulk?op=launch|restart|stop|align`(읽기만. `claude agents`를 못 읽으면 `502`이고 계획하지 않는다): 세션마다 순서·동작·이유·`from → to`·drift. 이미 떠 있음(LAUNCH), 떠 있지 않음(STOP·ALIGN), atc가 다시 띄울 수 없는 tmux·데스크톱 세션, 목표 ACCOUNT가 거절함(로그인 안 됨, FUEL hold, `maxLaunched`)이면 사유와 함께 건너뛴다.
- **보류 행.** 잃는 것이 있는 STOP·RESTART 행(job이 턴 도중이거나 사람을 기다림, CONTROL RECYCLE의 안전한 순간 조건: RTS, TOWER 이벤트·overdue CLEARANCE, OCC의 안 나간 FLIGHT PLAN·열린 CREW CHANGE, MCC 착륙 중)은 보류다. SUPERVISOR가 "알고도 진행"(`force`)을 눌러야 한다. LAUNCH는 잃을 것이 없다.
- **확인과 실행.** `POST /api/control/bulk` `{ op, expect, force? }`(SUPERVISOR만: 이 화면 Origin·JSON). `expect`는 화면이 미리 본 `{ 세션: 동작 }`이고, 지금 동작이 다른 세션은 건드리지 않는다. 한 번에 하나(`409`).
- **결과와 기록.** 패널이 세션마다 결과를 보인다. FLIGHT RECORDER: 세션마다 `control` `launch`·`stop`·`recycle` 줄(RESTART·ALIGN은 reason `CONTROL BULK RESTART|ALIGN: from → to`인 `recycle`)과, 한 번 실행에 `control` `bulk` 요약 한 줄(`bulk`, `force`, 개수, 세션별 결과).
- **복구 배너.** LAUNCH할 수 있는 관제 세션이 하나도 떠 있지 않으면(예: 호스트 재부팅 뒤) 헤더 CONTROL 띠에 `모두 내려감 · LAUNCH ALL`, CONTROL 그룹에 LAUNCH ALL 미리 보기 버튼이 있는 배너가 뜬다. 목록을 못 읽었으면 아무것도 보이지 않는다. atc가 스스로 띄우지는 않는다.
- **PILOT'S DISCRETION.** 위의 순서, RESTART ALL이 떠 있지 않은 것도 LAUNCH함, 보류 행은 `force`가 있어야 함.
- **하지 않은 것.** 모두 내려갔을 때의 SUPERVISOR 알림·소리, 자동 복구, AIRCRAFT 일괄 동작(범위 밖).


### RESTARTING as built (ATC-91)

데스크톱의 `/clear`는 세션을 끝내고 다음 세션에 새 id를 준다. 이름은 이어진다. 한동안 AIRCRAFT에 세션이 없어서 FLEET는 `absent`를 보였고 DISPATCH는 승인된 제안을 닫았다([dispatch.ko.md](dispatch.ko.md) 6.4). ATC-91은 그 틈을 하나의 상태로 만든다: `RESTARTING`, 최대 `restartGraceMin`(기본 30, `dispatch.json`. `0`이면 RESTARTING을 끄고 그것을 위해 아무것도 읽지 않는다. 음수·숫자가 아닌 값은 30). launch 카드가 새 세션을 기다리는 시간은 따로 `launchCardTimeoutMin`(ATC-507, 기본 30, 양수만, 끌 수 없다, [dispatch.ko.md](dispatch.ko.md) 6.4)이다.

**Step 0, 실제 파일에서(2026-09-29).**

- **`/clear`가 남기는 것.** 이 기계에서 두 경우가 있다. TEAM_J 자신의 `/clear`(09-28 17:07:14Z): 옛 대화 기록 `4a0c058e…`의 마지막 쓰기는 17:07:14.911Z이고, 새 것 `7e5461b1…`은 5 ms 먼저(17:07:14.906Z) 태어나 이미 `custom-title`·`agent-name` `TEAM_J`, `/clear` 명령 줄과 빈 출력을 담았다. 첫 지시는 17:07:28Z. TEAM_I의 `/clear`(ATC-91의 경우): 옛 `04a9a868…`의 마지막 쓰기 01:41:20Z, 그 뒤 01:49:24.583Z에 첫 지시 `TEAM_I`와 `custom-title TEAM_I`로 `085b1336…`이 태어날 때까지 새 대화 기록이 없다. 그러니 `/clear` 때 새 파일이 생길 수도 아닐 수도 있고, 그 사이 세션 파일(`~/.claude/sessions/<pid>.json`)은 없다. atc는 어느 쪽에도 기댈 수 없다. 두 대화 기록에 끝 표시는 없다: 마지막 줄은 `stop_hook_summary`와 `last-prompt`다.
- **이름은 이어진다.** 두 경우 모두 새 세션의 `custom-title`이 옛 것(`TEAM_J`, `TEAM_I`)이고, 세션 파일도(생기면) 같은 이름이다. id는 새것이다. (TEAM_I는 지금 `cli` 세션인데 이는 `/clear`의 효과가 아니라 진입점이 따로 바뀐 것이다.)
- **hook.** 이 기계에는 `SessionStart`·`SessionEnd` hook이 없고(`~/.claude/settings.json`에 `PreToolUse`·`PostToolUse`·`StopFailure`·`Stop`·`Notification`뿐) 어떤 대화 기록에도 그 `hookEvent`가 없어서, 데스크톱 세션에서 그것이 도는지는 파일로 알 수 없다. Claude Code 2.1.284 바이너리는 `SessionEnd`와 `reason` `clear | resume | logout | prompt_input_exit | other`를 정의한다. 시험하려면 SUPERVISOR의 `settings.json`에 hook을 넣어야 하는데 이 변경은 건드리지 않는다. **결정: hook 없음.** 파일만으로 찾으므로 PR이 `hooks/` 밖에 머문다. hook은 즉시성만 더하고 나중에 더할 수 있다.

**찾기**(`server/restarting.ts`의 순수 함수 `restartingOf`. 읽기는 `server/sources/claude.ts`의 `readEndedSessions`). 세션 파일이 없고(상태와 무관: 죽은 pid의 파일은 clear가 아니라 crash다), `restartGraceMin` 안에 쓰였고, 마지막 `custom-title`이 REGISTRATION으로 읽히고, 마지막 사실이 도구 호출이 남지 않은 답인(정상 종료: API 오류·승인 대기·대답 없는 지시는 `health`가 다룬다) 대기 기록이 있으면 그 REGISTRATION은 마지막 쓰기 뒤 `restartGraceMin` 동안 `RESTARTING`이다. 같은 REGISTRATION의 살아 있는 세션이 뜨면(`Team I`도) 바로 끝나고, 유예가 지나면 끝난다. 시계는 atc의 기억이 아니라 대화 기록의 마지막 쓰기라서 서버를 다시 띄워도 잃지 않는다. `snapshot.restarting`이 목록이다. 사람이 일부러 닫은 세션도 유예 동안은 같게 보인다. hook이 필요 없는 값이다.

**보이는 곳.** `GET /api/fleet`이 `restarting: {registration, name, sessionId, since, until}`(없으면 `null`)을 주고 `status: "absent"`는 그대로여서 FLEET PLAN은 전과 같이 보되, `RESTARTING` AIRCRAFT에는 `LAUNCH`를 제안하지 않는다(SUPERVISOR가 곧 말을 건다). FLEET 상태 목록은 STATUS `RESTARTING`과 FLYING 칸의 `세션 없음 — /clear 뒤 첫 메시지 대기`를 보이고, 카드는 기다리는 시각과 승인된 제안이 열려 있다는 것을 같이 적는다. DISPATCH는 [dispatch.ko.md](dispatch.ko.md) 6.4.

### 유휴 종료와 DISPATCH의 LAUNCH as built (ATC-129)

FLIGHT를 마치고 기다리는 백그라운드 AIRCRAFT는 한 시간 뒤 사라지고, ATC-129 전에는 DISPATCH에서도 빠졌다: planner는 살아 있는 세션만 본다. 이제 세션이 없는 백그라운드 AIRCRAFT도 후보로 남고, 그 카드를 승인하면 OCC가 FLIGHT PLAN을 보내기 전에 띄운다(8.5의 `launchAircraft`). DISPATCH 쪽은 [dispatch.ko.md](dispatch.ko.md)의 "LAUNCH on approve와 RESUME as built (ATC-129)".

**Step 0: 유휴 종료(2026-09-29, Claude Code 2.1.284, 읽기만).**

- **일어나는 일.** 백그라운드 daemon(`claude daemon run`, 8.5)이 60분쯤 쉰 백그라운드 worker를 거둔다. 로그 `~/.claude/daemon.log`에 한 줄씩 남는다:
  - `05:34:30Z bg retire 2b7110c1: settled, idle 60m`, `bg settled 2b7110c1 (done)`: TEAM_G, 마지막 턴 04:34:21Z.
  - `05:44:30Z bg retire a7bd6d77: idle-prompt, idle 60m`, `bg retire 0edf3386: idle-prompt, idle 60m`: TEAM_I, TEAM_K.
  - `06:20:30Z bg retire 647369e3: idle-prompt, idle 97m`: TEAM_J, 마지막 턴 05:19:44Z.
  - 그 전: `2026-09-28T19:10:30Z bg retire 44a0a5d5: settled, idle 61m`(TEAM_K), `2026-09-29T04:21:30Z bg retire dd6ea8ef: stale-spare, idle 61m`(쓰이지 않은 예비 worker).
- **로그의 사유**는 `settled`(턴이 끝나 job이 `done`), `idle-prompt`(프롬프트에서 기다림), `stale-spare`(아무도 쓰지 않은 미리 띄운 예비)다. 검사는 1분 주기다(모든 retire가 `:30`초). 그래서 job이 마지막으로 바뀐 뒤 60~61분에 끝난다. J의 97분: 쉰 시간은 job의 `updatedAt`부터 세고, 다른 것(최근 입력이나 도는 작업, 아래 규칙)이 06:20Z까지 거두기를 막았다.
- **그 뒤.** `~/.claude/jobs/<id>/state.json`은 `state: "done"`이고 `lastTerminalAt`이 retire 시각이다(G `05:34:30.488Z`, J `06:20:30.456Z`). `~/.claude/sessions/`의 세션 파일은 없어지고, `claude agents --json`에 `pid`가 있는 줄이 없고, FLEET는 `absent`다. 대화 기록은 그대로다: 마지막 쓰기가 마지막 턴이라 RESTARTING(ATC-91)이 retire를 `/clear`로 오해하지 않는다(유예가 한참 전에 지났다).
- **바이너리의 규칙**(2.1.284 daemon 코드의 `retireIfSettled`, `grep`·`dd`로 읽기만 하고 실행하지 않았다). 60초마다 한 바퀴 돈다(`Me=60000`). job이 `~/.claude/jobs/<id>/state.json`의 `updatedAt`부터 `3600000` ms(1시간. 원격 클라이언트에 이어진 세션은 `28800000`, 8시간. 메모리가 모자라면 60초) 넘게 쉬면 worker를 거둔다. 클라이언트가 붙어 있을 때(`claude attach`), 고정(pin)됐을 때, 최근 입력이 있을 때, routine이나 세션 cron(`/loop`)이 걸려 있을 때, 작업이 돌고 있을 때는 거두지 않는다. 사유는 job 상태가 끝났으면 `settled`, 아니면 `idle-prompt`, 쓰이지 않은 예비면 `stale-spare`다. 기준은 상수다: 환경 변수나 설정이 들어가지 않는다.
- **관제 세션이 살아남는 까닭.** TOWER·OCC·MCC는 `/loop`를 돌려 세션 cron이 걸려 있으니 "settled"가 되지 않고, 몇 분마다 tick이 턴을 시작한다.
- **설정.** 2.1.284의 `claude --help`와 설정 목록에 백그라운드 세션의 유휴 시간 제한은 없고, 그것을 늘리는 문서화된 길도 없다. 고정(agent view의 pin)이나 붙어 있는 클라이언트는 거두기를 막고 `/loop`는 세션을 바쁘게 두지만, atc는 어느 것도 쓰지 않는다. 세션을 붙잡아 두지 않고 승인 때 다시 띄우며, keep-alive 메시지는 보내지 않는다.
- **문서.** Claude Code의 agent view 문서(code.claude.com/docs/en/agent-view)는 끝났거나 다음 메시지를 기다리며 한 시간쯤 아무도 붙지 않은 세션을 supervisor가 멈춰 자원을 푼다고 적는다. 계속 돌게 하는 것은 고정(agent view에서 Ctrl+T)뿐이다. 늘리는 설정은 없다.
- **이어 가는 길(쓰지 않음).** 대화는 남는다. `claude --help`(2.1.284)가 적는 길은 셋이다: `claude attach <id>`(대화형, 터미널 필요), `claude --resume <session-id>`, 그리고 "그 세션을 같은 ID로 백그라운드에서 이어 가는" `claude --bg --resume <session-id> "<지시>"`. 마지막 것은 끊긴 FLIGHT를 맥락째 이어 갈 수 있다. `claude respawn <id>`는 도는 세션을 지금 바이너리로 다시 띄울 뿐이다. ATC-129는 명세대로 새 LAUNCH(`launchAircraft`, FLEET 버튼과 같은 길)를 쓰고 STAND·브랜치·마지막 커밋·마지막 보고를 FLIGHT PLAN에 싣는다. `--bg --resume`으로 이어 가기는 나중에 바꿀 수 있는 길이고, 여기서 시험하지 않았다.

**어떤 AIRCRAFT인가**(`snapshot.absent`, 읽기는 `server/absent-run.ts`, 순수 함수 `absentOf`는 `server/dispatch-launch.ts`).

- 그 REGISTRATION의 살아 있는 세션(출처 무관)이 없고, `RESTARTING`이 아니고, 등록부(`fleet.json`)에 있고 RETIRED가 아니다.
- **백그라운드 출처:** 최근 14일 FLIGHT RECORDER에 성공한 atc LAUNCH(`kind: "fleet"`, `op: "launch"`, `ok`)가 있다. 데스크톱·터미널 AIRCRAFT는 그런 줄이 없어 이 길로 띄워지지 않는다. 그 LAUNCH의 permission mode와 모델을 다시 쓴다.
- **cut**(ATC-86): 그 LAUNCH의 job id로 대화 기록을 찾는다(`~/.claude/projects/*/<jobId>-….jsonl`, 세션이 워크트리로 옮겨 갔어도). 그 끝이 한도로 잘린 턴이면(마지막 지시와 마지막 `release` 뒤에 `wrap_up` 안내) `cut`에 잘린 시각, ACCOUNT의 FUEL 기록에서 되짚은 reset(`cutResetOf`, 살아 있는 cut과 같다), CAPTAIN 마지막 메시지의 마지막 줄을 싣는다. cut 뒤에 새 지시가 있으면 cut이 아니다. 대화 기록은 LAUNCH한 저장소(와 그 워크트리)의 프로젝트 폴더를 먼저 보고, 없을 때만 모든 폴더를 본다. 찾은 경로는 계속 쓰고, 못 찾으면 10분 뒤 다시 찾는다. FLIGHT RECORDER는 1분에 한 번 읽고, 대화 기록 끝은 크기·mtime으로 캐시한다.
- `GET /api/snapshot`의 `absent: [{registration, launchedAt, jobId, permissionMode?, model?, cut: {sessionId, cutAt, resetsAt | null, weekly?, report} | null}]`.

**카드의 LAUNCH.** `launchAircraft`를 부르는 것은 이 화면에서 누른(`fromThisApp`) DISPATCH `launch` 카드의 승인뿐이다. tick이나 타이머는 부르지 않는다. FLIGHT RECORDER 줄은 8.5의 것에 `by: "SUPERVISOR"`와 새 필드 `proposal: "D-xxxx"`다. 카드에서 온 LAUNCH는 `claude --bg`를 부르기 전에 거절된 것(상한, 이미 떠 있음, RETIRED)도 이제 남긴다. 상한(`ATC_MAX_LAUNCHED`)은 살아 있는 백그라운드 세션에 승인됐지만 아직 세션이 뜨지 않은 `launch` 카드를 더해 센다.

**RESUME.** 한도로 끊긴 FLIGHT는 reset 뒤 같은 REGISTRATION의 RESUME 카드로 돌아온다([dispatch.ko.md](dispatch.ko.md)). SUPERVISOR가 손으로 보내던 "계속"을 대신하는 것은 세션이 없는 백그라운드 AIRCRAFT뿐이다. 살아 있는 세션의 `RESUME`은 위 ATC-86대로다: `RESUME 필요`, SUPERVISOR가 그 세션에서 "계속"을 보낸다.

### ACCOUNT별 LAUNCH (ATC-147)

ACCOUNT 폴더를 등록하면([accounts.md](accounts.md) 5.2) 등록된 어느 ACCOUNT에서도 LAUNCH·STOP을 한다.

- **어느 ACCOUNT.** AIRCRAFT 프로필의 `account`(관제 세션은 `control` 라벨), 또는 요청에 적은 ACCOUNT. LAUNCH 패널에 고르개가 있다(SUPERVISOR만). 로그인이 안 됐거나, FUEL hold 수준이거나, 그 ACCOUNT의 `maxLaunched`에 닿은 ACCOUNT는 사유와 함께 흐리게 보이고 요청해도 거절한다. 등록부가 없으면 달라지는 것이 없다(인자·환경 그대로).
- **환경.** 더하는 변수는 그 ACCOUNT 폴더의 `CLAUDE_CONFIG_DIR` 하나뿐이다(`~/.claude`면 더하지 않는다). LAUNCH는 여전히 자기 systemd scope에서 돌아, daemon은 `atc.service` 밖에 산다.
- **폴더마다.** `claude agents --json`은 폴더마다(daemon이 떠 있을 때) 읽어 `account`를 붙여 합친다. `claude stop`은 그 줄의 폴더로 부른다. LIMIT 뒤 RESUME(8.5 ATC-129)은 마지막 atc LAUNCH의 ACCOUNT에서 띄운다. 등록부가 있으면 FLIGHT RECORDER의 launch·stop 기록에 `account`가 남는다.
- **상한.** `ATC_MAX_LAUNCHED`는 기계 전체 그대로, ACCOUNT별 `maxLaunched`는 등록부에서 고른다(기본 없음).

### 8.6 FLEET PLAN: LAUNCH·STOP 등을 제안하기

상태: 1·2단계 만듦(그림자, 2026-09-28). `REFRESH`(객실 정비, ATC-69)도 함께 만들었다. SUPERVISOR 결정은 아래에 적었다. 8.5가 SUPERVISOR에게 조종 버튼을 줬다면, 이 절은 atc가 언제 그 버튼을 쓰자고 제안할지 정한다. 팀을 꾸리고, 세우고, 정비하고, 퇴역시키는 일을 손으로 챙기지 않게 하려는 것이다.

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

1. **근거와 함께 제안하고, SUPERVISOR가 정한다.** 항공사의 최적화 도구(crew pairing·rostering, disruption recovery)는 장단점을 밝힌 선택지를 순위대로 내고, 운항 통제가 승인한다. FLEET PLAN 제안에는 숫자가 붙은 사유 코드가 달리고, 그림자 운용으로 시작한다. agree·disagree만 하고, DISPATCH·SCHEDULE의 게이트(판정 20건, 합의율 80%)를 넘어야 승인 운용으로 간다. FLEET PLAN의 게이트는 ATC-273으로 판정 5건, 80%로 낮췄다(8.7 결정 1).
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
| `RESTART` | 정기 점검 | 백그라운드 세션이 PARKED이고 `restartDays`(기본 3)보다 오래됨. 또는 AIRCRAFT health(8.8)가 `CONTEXT`이거나 ALERT 수준의 `HUNG`(ATC-48) | STOP 뒤 새 CREW BRIEFING으로 LAUNCH(데스크톱·터미널 세션은 손으로 닫고 다시 연다) |
| `REFRESH` | 객실 정비(turnaround) | AIRCRAFT가 PARKED이거나 ARRIVED한 FLIGHT의 STAND만 쥔 HOLDING이고, 열린 PR과 이번 계획의 FLIGHT가 없고, 최근 `minDwell` 안에 띄우지 않았고, 대화가 `refreshTokens`(기본 300k)나 창의 `refreshPct`(기본 40 %)를 넘음(ATC-69) | 백그라운드 세션: `RESTART`와 같다. 데스크톱·터미널 세션: 실행하지 않는다. SUPERVISOR가 그 세션에서 `/clear`하고 CREW BRIEFING을 붙여 넣는다 |
| `REPOSITION` | 승무원 재배치 | 받을 AIRCRAFT가 없어서 기다리는 FLIGHT가 있고 소속 AIRCRAFT가 없는 AIRPORT로, FLIGHT 사이의 다른 AIRPORT 소속 AIRCRAFT를(위 REPOSITION 절, ATC-179) | STOP, 새 base 쓰기, 목표 AIRPORT 저장소에서 LAUNCH |
| `AOG` | 기한이 있는 MEL 유예 | 세션이 NORDO이거나 최근 24시간에 LOS. 또는 AIRCRAFT health(8.8)가 `MODEL`이거나 주간 `LIMIT`(ATC-48) | `until` = 지금 + 24시간으로 AOG(주간 `LIMIT`만이면 reset 날). 풀리지 않고 기한이 지나면 `RETIRE`나 복귀 제안이 뒤따름 |
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
- **API.** `GET /api/fleet/plan`은 `{mode, config, ranAt, error, demand, fuel, open, waiting, recent, gate}`를 돌려준다. `open[].now`는 지금 계산한 사유다. `waiting`에는 지속 조건을 기다리는 후보가 들어가고, 판정 뒤 쉬는 후보는 빠진다. `POST /api/fleet/plan/:id/verdict`는 `{verdict: "agree" | "disagree", reason?}`를 받는다. 이 화면의 Origin이 있어야 하고(아니면 403), 닫힌 제안에는 409를 돌려준다.
- **탭.** 카드 위에 FLEET PLAN 블록이 있다. 게이트, AIRPORT별 수요 한 줄과 LAUNCH를 막는 이유, ACCOUNT별 FUEL 한 줄(아래), 사유가 붙은 열린 제안과 반대·동의 버튼, 지켜보는 후보, 최근 닫힌 제안이 보인다.
- **FUEL(ATC-63, [fuel.md](fuel.md) 6).** FLEET PLAN이 ACCOUNT별 FUEL REMAINING(`snapshot.fuelAccounts`, 관제 세션 포함)을 읽는다.
  - **hold 수준**(`holdPct`, 기본 95 %): 그 ACCOUNT의 AIRCRAFT는 LAUNCH하지 않는다. 다음으로 맞는 AIRCRAFT를 고르고, hold인 AIRCRAFT를 건너뛴 LAUNCH에는 `fuel-held` 사유가 붙는다. 맞는 AIRCRAFT가 모두 hold면 ENTRY도 내지 않고 아무것도 제안하지 않는다. AIRPORT 수요 줄이 이유를 말한다: `FUEL 사용 100% (account acct-1) until 21:48Z — TEAM_Q — ENTRY도 제안 안 함(새 세션이 열릴 계정을 모름)`. 새 세션은 이 기기에 로그인된 계정으로 열리는데 atc는 그 계정을 모르기 때문이다(ENGINEERING 결정: AIRCRAFT가 모두 한 ACCOUNT면 ENTRY는 바닥난 같은 계정에 새 세션을 띄우는 제안이 된다).
  - 평소의 ENTRY(맞는 등록 AIRCRAFT가 아예 없음)는 새 AIRCRAFT를 `default` ACCOUNT로 세고, `default`가 hold면 내지 않는다: `FUEL 사용 97% (account default) until 21:49Z — 새 AIRCRAFT(ENTRY)가 들 ACCOUNT`.
  - DISPATCH FUEL HOLD 스위치(D3)와 상관없이 hold 수준을 쓴다(ENGINEERING 결정). 제안은 조언이고, 빈 ACCOUNT에 세션을 띄우자는 제안은 쓸모가 없다. DISPATCH 동작은 그대로다.
  - **info 수준**(`infoPct`, 기본 80 %): 제안은 하고 `fuel` 사유 줄을 단다(`FUEL 사용 85% · resets 21:00Z (account acct-1) — 한도에 가까움(INFO) · TEAM_I · control OCC`).
  - **찾는 법**: AIRCRAFT의 ACCOUNT 라벨로 찾는다. 운항하지 않는 AIRCRAFT는 세션이 없어 자기 값이 없기 때문이다. 관제 세션만 적은 ACCOUNT도 잡힌다. 라벨이 하나도 없으면 AIRCRAFT는 자기 세션의 값만 보고, ENTRY는 볼 ACCOUNT가 없다. FUEL 기록이 없으면 아무것도 바뀌지 않는다.
  - **expire**: 열린 LAUNCH·ENTRY의 ACCOUNT가 hold가 되면 다음 주기에 FUEL 글을 사유로 expire한다. 같은 후보가 여전히 나와도 그렇다. 같은 AIRPORT의 새 후보는 supersede가 아니라 새로 낸다.
  - **블록**: ACCOUNT마다 한 줄. 가장 많이 쓴 창과 reset, hold면 `LAUNCH·ENTRY 제안 안 함`, info면 `제안에 FUEL 사유 줄`, 그 AIRCRAFT와 관제 세션. `GET /api/fleet/plan`의 `fuel`로 오고, 계획 주기가 아니라 볼 때의 스냅샷에서 읽는다.
  - STOP·RESTART·AOG·RETIRE·RETURN 규칙, 승인 운용 실행, 기록 형식은 그대로다.
- **운영 데이터로 처음 본 결과(2026-09-28 07:15 UTC):** 제안 없음. ATC-35는 TEAM_I가 받을 수 있고, 나머지 열린 ATC FLIGHT는 우선순위가 없다. 팀 세션은 모두 데스크톱 세션이다. NORDO·LOS가 없고, 모든 AIRCRAFT가 30일 안에 ARRIVED했다.

아직 안 만든 것: 4단계(자동 STOP). 3단계(승인 운용)와 기한이 지난 AOG 뒤의 제안(RETURN)은 8.7에서 만들었다. 활주로 규칙의 머지 슬롯 점유, FLEET PLAN 제안의 CROSSCHECK mark. 주간 사용량 줄(FUEL)은 만들었다(ATC-63, 위).

**구현 순서.**

1. ✅ 순수 함수 `fleetPlanOf(snapshot, fleet, dispatchPlan, logbook, sessions, atfm, config, now)`와 종류마다, 그리고 왔다 갔다 방지 규칙의 테스트.
2. ✅ 그림자: 기록, API, FLEET PLAN 블록, agree·disagree, 게이트.
3. 승인 운용(`dispatch.json`이나 별도 파일의 스위치): approve가 8.5와 프로필 수정으로 실행.
4. atc가 띄운 쉬는 세션의 자동 STOP만: 스위치, 하루 상한, 7일에 SUPERVISOR가 두 번 되돌리면 꺼짐.

**위험.**

| 위험 | 대응 |
|---|---|
| LAUNCH·STOP이 왔다 갔다 함 | 두 주기 지속, `minDwell`, 예비를 이력(hysteresis)으로 |
| 사용량이 바닥남 | 백그라운드 상한(8.5), LAUNCH는 자동 없음. FUEL hold 수준인 ACCOUNT로는 LAUNCH·ENTRY를 제안하지 않고, 블록에 ACCOUNT별 FUEL 줄(ATC-63) |
| 수요 신호가 틀림(상위 이슈, 라벨 없음) | planner의 제외 규칙을 통과한 FLIGHT만 센다. 제외된 FLIGHT는 보이기만 하고 세지 않는다 |
| 팀은 늘었는데 착륙 대기열은 그대로 | 활주로 규칙(원칙 3) |
| RESTART가 쓸모 있는 맥락을 잃음 | PARKED 세션만. 옛 대화는 남아서 다시 이어진다 |

**결정 (2026-09-28, SUPERVISOR).**

- 기본값은 제안대로: `reserve` 1, `waitMin` 120, `idleHours` 12, `restartDays` 3, `retireDays` 30, `minDwell` 2시간. 이후 조정은 그림자 기록과 게이트로 정한다.
- ATC FLIGHT도 수요로 센다. FLEET PLAN은 `candidateTeams`만이 아니라 `LINEAR_TEAM_KEYS`의 모든 팀에서 열린 FLIGHT를 세고, 제외 규칙은 planner와 같다(상위 이슈, 닫힌 상태, 다른 AIRCRAFT로 가는 `tail:`). DISPATCH는 `candidateTeams`만 배정한다. 2026-09-28에 ATC를 거기 넣어 ATC FLIGHT도 DISPATCH가 배정한다. ATC FLIGHT도 워크스페이스 분류 라벨을 쓴다. 라벨이 없는 FLIGHT는 rating 확인을 건너뛰고 사유에 그렇게 적는다.
- 4단계(자동 STOP)는 계획에 두되 마지막에 만들고, 스위치는 기본으로 꺼 둔다. 켜는 것은 그림자 게이트를 통과한 뒤 SUPERVISOR가 따로 정한다.
- REFRESH(ATC-69, 작업 지시의 PILOT'S DISCRETION, SUPERVISOR 검토 대상): RESTART의 셋째 조건이 아니라 따로 둔 종류다. 그래야 게이트가 판정을 따로 세고, 데스크톱 세션에는 거절 대신 손으로 할 단계를 보인다. 기준은 `refreshTokens` 300k와 `refreshPct` 40 % 중 먼저 닿는 것. 데스크톱·터미널 세션은 자동으로 다시 띄우지 않고, 자동 STOP은 여전히 4단계가 정한다.

출처: [Jeppesen crew pairing](https://ww2.jeppesen.com/airline-crew-optimization-solutions/airline-crew-pairing/), [Lufthansa Systems NetLine/Crew](https://www.lhsystems.com/solutions/operations-control-center/netline-crew), [항공 disruption recovery 조사(arXiv 2510.26831)](https://arxiv.org/html/2510.26831), [OAG: wet leasing](https://www.oag.com/blog/what-is-wet-leasing), [SKYbrary: MEL](https://skybrary.aero/articles/minimum-equipment-list-mel), [EASA AI 등급(Halldale)](https://www.halldale.com/civil-aviation/easa-ai-framework-aviation-safety-regulations), [ICAO: 항공기 주기](https://www.icao.int/operational-safety/Aircraft-Parking).

### ACCOUNT CHANGE (ATC-148)

새 FLEET PLAN 종류. AIRCRAFT의 ACCOUNT가 바닥났을 때 FLIGHT 사이에 다른 ACCOUNT로 옮기자고 제안한다. 스스로 옮기는 일은 없고 자동 모드도 없다.

- **언제**(`accountChangeOf`, 순수, `server/fleet-plan.ts`. ACCOUNT를 등록해 둔 경우만, [accounts.md](accounts.md) 5.1): 아래가 모두 맞을 때
  - AIRCRAFT의 관찰한 ACCOUNT가 `holdPct`(D3 스위치와 상관없이)이거나, reset이 `accountChangeLimitMin`(기본 60)분 넘게 남은 `LIMIT`이 있거나, home이 아닌 ACCOUNT에서 나는데 home이 다시 `infoPct` 아래가 됐을 때(돌아가는 길도 평범한 제안이고 자동이 아니다);
  - FLIGHT 사이: 백그라운드 세션이 쉬고, 쥐거나 남겨 둔 FLIGHT가 없고, 열린 PR이 없고, 이번 계획에서 FLIGHT를 받지 않고, `minDwellMin` 안에 띄운 것이 아님. `LIMIT`으로 잘린 턴(RESUME)은 옮기지 않는다;
  - 다른 등록 ACCOUNT가 로그인 안 됨으로 알려지지 않았고 `infoPct` 아래이고 `maxLaunched` 아래. 목표는 그중 사용이 가장 낮은 것(FUEL 기록이 없으면 0, 같으면 라벨 순). home이 유일한 이유면 home로 간다.
- **사유**는 두 ACCOUNT의 사용과 reset(`FUEL 사용 97% (account acct-2) until 21:00Z — hold 수준`, `옮길 ACCOUNT acct-3: 사용 10%(reset 21:00Z) …`), FLIGHT 사이라는 것, 새 세션이 캐시 없이 시작한다는 것을 적는다.
- **승인하면**(승인 운용, SUPERVISOR): 먼저 목표 ACCOUNT를 본다(로그인, FUEL hold 아님). 거절이면 옛 세션은 멈추지 않는다. 그다음 옛 ACCOUNT 폴더로 `claude stop`, 목표 ACCOUNT에서 기존 CREW BRIEFING으로 LAUNCH(`launchAircraft`에 `account`, 마지막 LAUNCH의 permission mode·모델). 두 단계는 평소의 `stop`·`launch` 기록 옆에 FLIGHT RECORDER의 `account-change` 사건 하나(`from`, `to`, `jobId`, `proposal`)로도 남는다. 프로필의 home ACCOUNT는 그대로고 카드는 `flying on acct-1 (home acct-2)`로 보인다.
- **반대하거나 expire하면** 아무 일도 없다. AIRCRAFT가 FLIGHT를 받거나(FLIGHT 사이가 아니게 됨), 옛 ACCOUNT의 창이 풀리거나(`holdPct` 아래, LIMIT이 풀리거나 기준 아래), 목표가 `infoPct`에 닿으면(FUEL 사유) expire한다. 가장 좋은 목표가 바뀌면 열린 제안은 새 제안으로 바뀐다(supersede). 승인할 때 다시 본다: 그새 FLIGHT를 받았으면 거절("살아 있는 FLIGHT는 옮기지 않는다").
- **AOG.** 옮길 ACCOUNT가 있으면 주간 `LIMIT`만으로는 그 AIRCRAFT에 AOG를 제안하지 않는다(8.8).
- **DISPATCH·FOLLOWING**은 이미 관찰한 ACCOUNT를 쓰므로([fuel.md](fuel.md) 6.2) 옮긴 AIRCRAFT는 새 ACCOUNT로 세고 다시 배정할 수 있다(`server/accounts.test.ts`).
- **FUEL.** 새 세션의 cold 첫 요청은 `ACCOUNT CHANGE`라는 이름의 FUEL LEAK다([fuel.md](fuel.md) 6.3).
- **APPLY NOW**(ATC-244, [accounts.md](accounts.md) 5.5)는 LAUNCH ACCOUNT에 있지 않은 쉬는 AIRCRAFT마다 같은 실행기를, 한 번의 확인 뒤 STOP 전에 FLIGHT 사이인지 다시 보고 돌린다. 바쁜 AIRCRAFT는 기다렸다가 FLIGHT가 끝나면 따라간다.

### LAUNCH ACCOUNT와 ACCOUNT CHANGE(ATC-239)

SUPERVISOR는 AIRCRAFT용 **LAUNCH ACCOUNT**를 정할 수 있다(설정 창 ACCOUNTS, [accounts.md](accounts.md) 5.4). 정해져 있고 등록돼 있는 동안 그것이 FLEET PLAN의 **효과 있는 home**이다:

- `accountChangeOf`는 프로필 `account` 대신 그것을 home으로 쓴다: 프로필 home으로 "돌아가자"는 제안이 없고, "돌아감"은 LAUNCH ACCOUNT로 돌아감이다(사유 `LAUNCH ACCOUNT acct-3: 사용 10% — infoPct 아래로 돌아옴`, 세션 줄에는 프로필 home이 그대로라고 적힌다). hold나 긴 `LIMIT` 때문에 옮기는 제안은 그대로다.
- `entryAccountOf`는 새 AIRCRAFT가 날 ACCOUNT로 LAUNCH ACCOUNT를 적는다. 그 ACCOUNT가 로그인 안 됨이거나 FUEL hold면 다른 ACCOUNT로 돌리지 않고 사유와 함께 ENTRY를 막는다(`새 AIRCRAFT(ENTRY)가 날 LAUNCH ACCOUNT acct-1를 쓸 수 없음 — …`).
- `fuelOfPlan`은 LAUNCH·ENTRY 제안의 FUEL을 LAUNCH ACCOUNT의 것으로 읽는다(STOP은 AIRCRAFT 자신의 것).
- 설정 때문에 돌고 있는 세션이 옮겨 가지는 않는다. ACCOUNT CHANGE는 여전히 AIRCRAFT마다 SUPERVISOR가 승인한다. 설정을 끄면 위의 것은 모두 전과 같다.

### LAUNCH MODEL (ATC-279)

SUPERVISOR는 AIRCRAFT LAUNCH가 쓸 모델을, ACCOUNT 폴더나 프로젝트 `settings.json`에 맡기지 않고 고를 수 있다(설정 창 ACCOUNTS, LAUNCH ACCOUNT 아래). `fleet.json`의 `launchModel` = `{ default?, airports?: { CODE: 모델 }, aircraft?: { REG: 모델 } }`이고, 옛 빌드가 읽지 않는 추가 칸이다. 값은 Claude Code 별칭(`opus`, `sonnet`, `haiku`, 뒤에 `[1m]`)이나 전체 ID(`^[\w.:[\]-]+$`)다. 비어 있으면(처음 값) 전처럼 `--model`을 붙이지 않는다.

- **정하는 곳은 하나.** `launchAircraft`(`server/session-control.ts`)가 순수 함수 `launchModelOf`(`server/launch-model.ts`)를 불러서, FLEET LAUNCH, DISPATCH launch 카드 승인과 RESUME(`server/index.ts`), FLEET PLAN 단계와 LAUNCH ACCOUNT APPLY NOW(`server/fleet-plan-run.ts`) 모든 AIRCRAFT LAUNCH 길이 같은 규칙을 쓴다. 부르는 곳의 목록과 `--model`을 만드는 곳이 하나뿐임은 테스트가 고정한다.
- **우선순위.** LAUNCH 양식·FLEET PLAN 승인 양식에 적은 모델(`form`) > AIRCRAFT(`aircraft`) > 그 AIRPORT(`airport`) > 기본(`default`) > 마지막 LAUNCH의 모델(`last`) > 없음(`none`). 마지막 LAUNCH의 모델(RESTART, ACCOUNT CHANGE, REPOSITION, APPLY NOW, DISPATCH 카드가 전에 재사용하던 값)은 맞는 설정이 하나도 없을 때만 쓴다: 설정이 SUPERVISOR의 지금 뜻이다. 양식 칸이 비어 있으면 이름을 안 댄 것이다. LAUNCH 단계에는 `model`(양식)과 `lastModel`(마지막 LAUNCH)이 따로 실린다.
- **기록.** FLIGHT RECORDER의 `fleet launch` 줄에 `model`(실제로 넘긴 값)과 `modelFrom`(`form|aircraft|airport|default|last|none`)이 있다. 설정을 바꿀 때마다 `launch-model` 줄이 한 줄 남는다(`scope` default|airport|aircraft, `key`, `from`, `to`, `by`).
- **API.** `GET /api/fleet/launch-model`(설정, 고를 모델, AIRPORT, AIRCRAFT)과 바꿀 칸만 적는 `PUT /api/fleet/launch-model`(`null`·`""`은 지움. 등록되지 않은 AIRPORT·AIRCRAFT 409, 잘못된 값 400, 이 화면 Origin이 없으면 403). `GET /api/fleet`에 `launchModel`이 실린다.
- **화면.** 설정 → ACCOUNTS → **LAUNCH MODEL**: 기본 고르개(폴더 기본, `opus`, `sonnet`, `haiku`, `claude-opus-5-5`, `claude-sonnet-5-5`, 직접 입력), AIRPORT마다 고르개, AIRCRAFT별 값의 칩(FLEET 카드 고치기에서 정하고 눌러서 지운다), 우선순위 한 줄과 FUEL 안내(Opus는 토큰당 비용이 크다. 저절로 바꾸지는 않는다). FLEET 행·카드에는 설정이 맞을 때 `next LAUNCH model <모델> (<출처>)`가, DISPATCH launch 카드에도 같은 글이 보이고, LAUNCH 패널의 모델 칸은 설정을 placeholder로 보인다.
- **여기서 하지 않는 것.** 관제 세션 모델, crew 서브에이전트 모델(`CLAUDE_CODE_SUBAGENT_MODEL`), 돌고 있는 세션 옮기기(다음 LAUNCH 때 새 모델을 쓴다). ACCOUNT·프로젝트 `settings.json`은 건드리지 않는다. 돌고 있는 세션이 실제로 쓰는 모델은 행에 보이지 않는다(만들지 않음: 글은 다음 LAUNCH가 쓸 모델을 말한다).

### REPOSITION (ATC-179)

FLEET PLAN의 새 종류: 쉬는 AIRCRAFT의 base를, FLIGHT가 기다리는데 소속 AIRCRAFT가 없는 AIRPORT로 옮긴다. DISPATCH가 AIRCRAFT를 자기 base AIRPORT의 FLIGHT와만 짝짓기 때문에([dispatch.ko.md](dispatch.ko.md) 4) 다른 AIRPORT에서 쉬는 AIRCRAFT는 그 FLIGHT를 받지 못한다. 살아 있는 세션은 저장소를 바꿀 수 없다(시작한 폴더의 `CLAUDE.md`를 읽는다). 그래서 옮기기는 STOP → 새 base 쓰기 → 목표 AIRPORT 저장소에서 LAUNCH다.

- **언제**(`repositionOf`, 순수, `server/fleet-plan.ts`). 목표: 받을 AIRCRAFT가 없어서(`no-aircraft`, 부모·우선순위·HOLD·슬롯·tail·rating 때문이 아님) 기다리는 FLIGHT가 있고, 소속 AIRCRAFT가 하나도 없고(퇴역·AOG는 안 세고 ABSENT는 센다), GROUND STOP이 아닌 AIRPORT. 출발 AIRCRAFT: 다른 AIRPORT 소속이고 **FLIGHT 사이**(ACCOUNT CHANGE와 같은 시험: 백그라운드 세션, 쉼, 쥔·보관한 FLIGHT 없음, 열린 PR 없음, 이번 계획에서 FLIGHT를 받지 않음)이고, RESTARTING·NORDO가 아니고, `LIMIT`이나 FUEL hold가 아니고, `minDwellMin` 안에 LAUNCH·STOP·옮김이 없고, 떠난 뒤에도 그 AIRPORT가 자기 FLIGHT 수만큼 AIRCRAFT를 갖고(계획 전체로 센다: 목표 둘이 한 출발 AIRPORT를 비우지 않는다), 기다리는 FLIGHT 하나는 날 수 있음(TYPE RATING, CREW COMPLEMENT). 후보 중 목표 AIRPORT에서 14일간 ARRIVED가 많은 것, 가장 오래 쉰 것, REGISTRATION 순. 계획마다 목표 AIRPORT당 하나. ACCOUNT CHANGE 후보인 AIRCRAFT는 건너뛴다.
- **사유**: 기다리는 FLIGHT(`DSGN: DSG-1 대기, 소속 AIRCRAFT 0`), 두 AIRPORT의 수(`ATCC: 쉬는 AIRCRAFT 4 → 3, 대기 FLIGHT 2`), FLIGHT 사이임, 맞음, 목표에서의 이력, 새 세션이 목표 저장소에서 캐시 없이 시작함.
- **모드**(`fleet-plan.json`의 `reposition`, FLEET PLAN의 `mode`와 별개 스위치. SUPERVISOR만, 설정 창 AUTOMATION 탭. 바꾸면 FLIGHT RECORDER에 `reposition` `mode` 한 줄. 기본 `shadow`, 배포 뒤에도):
  - `off`: 아무것도 안 함;
  - `shadow`: 두 주기 지속된 후보를 `reposition` `would`로만 남긴다(AIRCRAFT·짝마다 한 시간에 한 번). 멈추거나 띄우지 않는다;
  - `approval`: FLEET PLAN 카드. SUPERVISOR가 승인한다(permission mode·모델은 마지막 LAUNCH와 같게);
  - `auto`: atc가 새 카드를 `auto`로 스스로 승인한다. 설정 창에서 ⚠이고 CONTROL RECYCLE `on`과 같은 확인 단계를 거친다. 가드: 24시간에 `repositionDailyMax`(기본 4)건까지(넘는 카드는 SUPERVISOR용으로 열려 있음), AIRCRAFT마다 `minDwellMin`(기본 120)에 한 번, **flapping이면 auto가 멈춘다**: 모든 조건이 맞지만 `minDwellMin` 안에 직전 base로 되돌아가려는 AIRCRAFT가 있으면 아무것도 옮기지 않고 `reposition`을 `approval`로 되돌리고(`auto`가 남기는 `reposition` `mode` 줄과 사유) ADVISORY 알림. 자동으로 옮길 때마다 ADVISORY 알림 하나.
- **승인할 때(그리고 `auto`에서)** 그 순간 다시 확인한다(`executionOf`: 옛 제안 아님, FLIGHT 사이, 백그라운드 세션, 목표 저장소를 앎). 그다음 **STOP 전에** 목표를 본다: 저장소가 있고, 그 AIRCRAFT가 뜰 ACCOUNT가 로그아웃·FUEL hold가 아님. 거절하면 옛 세션은 그대로 돌고 `reposition` 줄(`stage: precheck`)로 남는다. 단계: `claude stop`(세션이 `claude agents`에서 빠질 때까지 기다림), `fleet.json`에 새 `base` 쓰기(FLEET 탭과 같은 원자적 쓰기), 목표 AIRPORT 저장소에서 CREW BRIEFING과 마지막 LAUNCH의 permission mode·모델로 LAUNCH. `stop`·`launch` 줄 옆에 `fleet` `reposition` 한 줄(`aircraft`, `from`, `to`, `jobId`, `proposal`, `by: supervisor|auto`, `ok`, 실패면 `stage`)이 남는다. base를 쓴 뒤 LAUNCH가 실패하면 base는 그대로 두고 사건에 `stage: launch`, CAUTION 알림이 그렇게 말하며 다음 DISPATCH가 그 AIRCRAFT를 ABSENT로 보여 LAUNCH 카드를 낸다.
- **만료**: 조건이 풀리면 카드가 닫힌다(FLIGHT를 다른 길로 받음, AIRCRAFT가 FLIGHT를 받거나 쉬지 않음, 목표에 AIRCRAFT가 생김). 가장 좋은 후보가 바뀌면 카드는 supersede된다. SUPERVISOR가 판정한 카드는 24시간 다시 내지 않는다.
- **화면**: FLEET PLAN 목록의 REPOSITION 카드(`ATCC → DSGN`), 설정 창 AUTOMATION 탭의 스위치, FLEET 탭 AIRCRAFT 카드에 base 옆 마지막 REPOSITION.
- **다른 규칙과의 관계**: REPOSITION은 LAUNCH 상한을 늘리지 않는다(백그라운드 세션 수가 전후 같다. LAUNCH는 그대로 상한·ACCOUNT별 상한을 거친다). FUEL hold도 바꾸지 않는다: hold인 AIRCRAFT는 옮기지 않고, 로그아웃·hold인 ACCOUNT는 STOP 전에 거절한다. 새 세션의 첫 요청은 cold cache다(FUEL LEAK `SESSION CHANGE`).
- **원칙 2의 예외**("되돌릴 수 있는 것만 자동으로"): REPOSITION `auto`는 STOP만으로 되돌릴 수 없다(새 세션이 다른 저장소에서 차갑게 시작한다). SUPERVISOR가 2026-09-30에 스위치(기본 `shadow`), 하루 상한, AIRCRAFT별 dwell, flapping 정지, 옮길 때마다 알림 아래에서 자동 모드를 허락했다.
- **만들지 않음**: base가 없는 AIRCRAFT에 base 주기(빠진 base는 FLEET 탭에서 고친다), 살아 있는 FLIGHT 옮기기, STOP·LAUNCH 없이 세션을 다른 저장소로 옮기기.

### ENTRY가 ACCOUNT를 고른다 (ATC-147)

- ACCOUNT를 등록하면 ENTRY 제안에 `account`가 실린다: 로그인이 안 됐다고 알려지지 않았고 `holdPct` 아래인 등록 ACCOUNT 중 사용이 가장 낮은 것(FUEL 기록이 없으면 0, 같으면 라벨 순). 사유 줄에 어느 ACCOUNT인지 적힌다(`새 AIRCRAFT는 ACCOUNT acct-1에서 …`). 승인하면 그 `account`를 프로필에 넣어 들이므로 뒤이은 LAUNCH가 그 ACCOUNT를 쓴다.
- 등록부가 있으면 옛 차단 "ENTRY도 제안 안 함(새 세션이 열릴 계정을 모름)"은 더 없다: 맞는 AIRCRAFT가 모두 hold여도 ENTRY는 다른 ACCOUNT로 간다. 맞는 ACCOUNT가 하나도 없으면 제안하지 않고 AIRPORT 줄이 ACCOUNT별 사유를 적는다(`acct-1: FUEL hold 100%, acct-2: 로그인 안 됨`). 열린 ENTRY의 ACCOUNT가 hold가 되면 expire한다.
- 등록부가 없으면 전과 같다(새 AIRCRAFT는 `default`로 세고, hold인 맞는 AIRCRAFT가 있으면 옛 차단).

### REFRESH 만든 것 (ATC-69)

FLIGHT를 마친 팀은 그 대화를 통째로 들고 있다. 2026-09-28에 TEAM_J는 ATC-63이 머지된 뒤 1M 창 중 504k를 들고 PARKED로 쉬었다. 턴마다 그 접두부를 캐시에서 다시 읽고, 캐시가 식은 뒤 처음 깨어날 때는 전부 다시 쓴다(F3의 COLD CACHE, [fuel.md](fuel.md) 5). 새로 시작하기에 가장 싼 때는 FLIGHT 직후, 팀이 쉬는 동안이다. REFRESH가 그것을 제안한다.

- **CONTEXT SIZE**(`server/fuel-context.ts`, 순수). 세션마다 마지막 CAPTAIN(non-sidechain) 요청의 `input + cacheRead + cacheWrite`와 그 시각·모델. FUEL F1이 이미 읽은 기록으로 센다. CREW 요청은 세지 않는다. 그 요청 뒤에 `compact_boundary`가 있으면 compaction의 `postTokens`로 바꾼다(줄에 없으면 모름). `base`는 세션의 첫 CAPTAIN 요청(시스템 프롬프트·규칙·CREW BRIEFING, 2026-09-28에 약 50k)이다. 새 세션도 어차피 다시 쓰는 몫이다.
- **창.** 대화 기록에는 `claude-opus-5-5`만 적히고 `[1m]` 접미어가 없다. 그래서 이 순서로 정한다: `fleet-plan.json`의 `contextWindows`(`{"claude-opus-5-5": 1000000}`, 모델 이름, `-YYYYMMDD` 접미어는 뗀다), 모델 이름의 `[1m]`, 그 세션에서 200k를 넘는 요청을 이미 봤으면 1M, 아니면 200k. 근거(`config`, `model`, `observed`, `default`. ATC-85가 `statusline`과 `model-command`를 더했다. 아래)가 크기와 함께 간다. `refreshPct` 기준은 창이 200k 짐작이 아닐 때만 쓰고, 짐작이면 `refreshTokens`만 본다.
- **아낌.** `(context − base)`를 F5 가격표로 매긴다. 다음 cold wake에 쓰지 않아도 되는 캐시 쓰기(세션의 지금 층, CAPTAIN은 1h)와 턴마다 읽지 않아도 되는 캐시 읽기. 2026-09-28 TEAM_J의 504k 세션은 Opus 5.5로 cold wake마다 약 $3.64, 턴마다 $0.09. 값이 없는 모델은 토큰만 보인다.
- **사유.** `context`(`502k / 1M (50%) — claude-opus-5-5, 2026-09-28 17:07Z (기준 300k 또는 40%, 창은 본 크기로 짐작)`), `saving`, `arrived`(마지막 ARRIVED FLIGHT와, 그런 FLIGHT의 STAND를 아직 쥐었으면 그것), `session`(값이 `background`나 `interactive`).
- **RESTART와 함께.** 같은 AIRCRAFT에 RESTART 후보(오래됨·health)가 이미 있으면 REFRESH를 따로 내지 않고 그 RESTART에 `context`·`saving` 줄을 붙인다. `minDwell`은 LAUNCH·RESTART 제안을 REFRESH의 반대 제안으로 본다.
- **승인.** 백그라운드 세션은 RESTART 단계로 실행한다(8.5 STOP, 그다음 마지막 LAUNCH의 permission mode·모델로 LAUNCH). 데스크톱·터미널 세션은 승인이 거절된다(409). 카드에 그 세션에서 `/clear`하고 CREW BRIEFING을 붙여 넣으라는 글과 **CREW BRIEFING 복사** 버튼이 있고, 승인 운용에서는 **했음**이 동의로 닫는다. 승인 운용에서 받는 유일한 동의다.
- **API.** `GET /api/fleet`은 AIRCRAFT마다 살아 있는 세션(여럿이면 가장 최근)의 `context: {contextTokens, window, at, pct, model, windowSource, compacted}`를 준다. `GET /api/fuel`은 세션마다, AIRCRAFT마다(기간 안 가장 최근 세션) 같은 것을 준다. 크기는 최근 7일에 바뀐 대화 기록으로 세고 60초 동안 같은 값을 쓴다.
- **화면.** FLEET 목록에 CONTEXT 열(`502k / 1M`, 40 %부터 색), 카드에 `context 502k / 1M (50%)` 줄과 시각·창의 근거가 보인다. ATC-81이 둘을 FOB로 바꿨다(아래).

### FRESH START 만든 것 (ATC-73)

REFRESH는 AIRCRAFT가 쉬는 동안에만 나와서, 배정이 먼저 오면 REFRESH가 사라진다. 2026-10-01에 F-0019가 TEAM_F(728k)에 REFRESH를 냈는데 같은 분에 D-0354가 ATC-311을 배정해 F-0019가 "조건이 풀림"으로 닫혔고, TEAM_F는 794k 대화를 턴마다 다시 읽으며 그 FLIGHT를 날았다. FRESH START는 바로 그 순간의 STOP과 LAUNCH이고, 첫 프롬프트가 그 일이다. DISPATCH 쪽은 [dispatch.ko.md](dispatch.ko.md) "FRESH START 만든 것 (ATC-73)".

- **내는 조건**(`freshStartVerdictOf`, 순수, `server/fresh-start.ts`): AIRCRAFT의 살아 있는 세션이 **백그라운드**다(데스크톱·터미널·모름은 멈추지 않는다. 사유를 보인다). 대화가 REFRESH 기준(`refreshTokens` 300k, 창을 알면 `refreshPct`, REFRESH와 같은 `overRefreshThreshold`)을 넘었다. 끝나지 않은 FLIGHT의 STAND가 없다(ARRIVED한 FLIGHT의 STAND는 괜찮다). AIRCRAFT가 idle(턴 중 아님)이고 RETIRED·AOG가 아니다. 아니면 DISPATCH 카드는 버튼 없이 사유만 보인다.
- **순서**(`runFreshStart`): STOP(8.5, 세션이 `claude agents`에서 빠질 때까지 기다림), 이어서 `launchAircraft`로 LAUNCH — `launchPlanOf`, 상한, ACCOUNT 규칙, LAUNCH MODEL이 다른 LAUNCH와 똑같이 걸리고 permission mode·모델은 마지막 LAUNCH와 같다 — 첫 프롬프트는 CREW BRIEFING, 구분선, FLIGHT PLAN. 제안은 LAUNCH가 성공한 뒤에야 보낸 것으로 센다. STOP이 실패하면 아무 일도 없다. LAUNCH가 거절되면 세션은 멈춘 채고 제안은 `approved` 그대로다(보낸 것이 없다): FLEET 카드에서 LAUNCH하거나 카드를 CANCEL한다.
- **SUPERVISOR만.** LAUNCH와 같은 Origin 검사(`fromThisApp`). 관제 세션의 CLI에는 없다(403). 자동으로 하지 않는다: FLEET PLAN이 제안하지도 실행하지도 않는다.
- **기록.** STOP과 LAUNCH는 늘 쓰던 FLIGHT RECORDER `fleet` 줄(`op: "stop"`, `op: "launch"`, LAUNCH에는 `proposal`)이다. FRESH START는 `dispatch` 줄 `{op: "fresh-start", id, via: "fresh-start", flight, aircraft, by, stage: "stop" | "launch" | "send", ok, jobId, error}`를 더하고, `send` 줄에 `via`가 붙는다.

### FOB as built (ATC-81)

FLEET 줄에서 둘이 모두 연료라 불리며 비슷하게 읽혔다: ACCOUNT의 사용 한도(**쓴 몫**, 같은 ACCOUNT의 모든 AIRCRAFT에 같은 값)와, ATC-69부터 있는 AIRCRAFT 자기 맥락. ATC-81(표시 글만)이 각자의 이름을 준다.

- **FOB(FUEL ON BOARD)**는 AIRCRAFT 자기 연료, 곧 창에 남은 몫이다. 목록 열은 `FOB 50% · 504k/1M`, 카드 줄은 `FOB 50% · 504k / 1M`. 색은 뜻을 따른다: 남은 몫 60 % 이하 노랑, 30 % 이하 빨강(ATC-69의 쓴 몫 40 %/70 %와 같은 지점). 화면에 적힌 정수 %로 가른다. 창이 200k 짐작일 뿐이면 토큰 기준(300k, 500k)이 그대로 가른다. `GET /api/fleet`은 필드 이름 `context`를 그대로 두고 `fobPct`(0–100, compaction 뒤 크기를 모르면 `null`)를 더한다. FLEET PLAN의 REFRESH `context` 사유 줄은 그대로다(쓴 몫을 말한다).
- **ACCOUNT 사용 한도**는 줄에서 빠진다. FLEET FUEL 블록, 카드, FLEET PLAN의 FUEL 줄에는 남고, 줄에는 하나만 둔다: ACCOUNT가 hold 수준(`holdPct`, DISPATCH 스위치와 상관없이, 전에 줄 색이 그랬듯)일 때 꼬리표 `HOLD · FUEL (account pro-2) until 21:00Z`. 붙들린 ACCOUNT는 배정을 막기 때문이다. 꼬리표에는 백분율이 없고 툴팁에 있다.
- **문구.** 사용 한도 글은 모두 쓴 몫이라고 말한다: 화면은 `사용 87% · resets 21:00Z`, TOWER `open.fuel`·FOLLOWING `fuel` 글과 FLEET PLAN FUEL 줄은 `FUEL 사용 87% · resets 21:00Z (account pro-2) — TEAM_K`, DISPATCH 사유는 `HOLD · FUEL (account pro-2) until 21:00Z — 5h 한도 사용 96%`. 값·임계값·규칙은 바뀌지 않았다.

### CONTEXT window from the session as built (ATC-85)

ATC-69는 대화 기록에 `[1m]`이 남지 않아 창을 짐작했다. ATC-85는 세션이 스스로 창을 말하게 하고, 짐작은 그대로 뒤에 둔다. 표시와 근거만 바뀐다: 임계값, FOB 글, REFRESH 규칙은 그대로다.

- **순서.** 세션마다 먼저 맞는 것: `statusline`(CLI 세션의 statusline 명령이 적은 `context_window_size`), `model-command`(대화 기록에 남은 그 세션의 마지막 `/model` 출력), `config`(`contextWindows`), `model`(모델 이름의 `[1m]`), `observed`(200k를 넘는 요청을 봄), `default`(200k). `GET /api/fleet`·`GET /api/fuel`의 `windowSource`가 어느 것인지 말하고, FLEET의 CONTEXT/FOB 툴팁에도 나온다(`창: 세션이 알림(statusline context_window_size)`, `창: 세션의 마지막 /model 출력`).
- **`statusline`**(CLI 세션: TOWER, OCC, MCC). hook이 `rate_limits` 옆에 `context_window_size`와 모델 id를 적는다([fuel.md](fuel.md) 6.1). 정확한 값이라 대화가 넘어도 그대로 보인다(FOB 0 %). 기록 뒤에 `/model`이 있었거나 세션의 마지막 요청이 기록과 다른 모델이면 낡은 기록으로 보고 건너뛴다.
- **`model-command`**(데스크톱 세션. statusline 기록이 없다). 대화 기록에는 `/model` 결과가 사용자 줄 `<local-command-stdout>Set model to \`claude-sonnet-5-5[1m]\`</local-command-stdout>`로 남는다. `[1m]`이면 1M, `[1m]`이 없는 `claude-*` id면 200k. Claude가 아닌 id(프록시로 도는 DeepSeek·Muse)나 표시 이름(`Sonnet 5`)은 창에 대해 말하지 않지만, 앞의 것을 끝낸다. 명령 뒤 요청이 그 창보다 크면 그 모델에 대해 명령이 틀린 것이니 `observed`로 돌아간다.
- **초기화.** 세션의 마지막 `/model` 앞 요청은 다른 모델의 것이라 `observed`로 세지 않는다. 새 세션은 빈 채로 시작한다. 2026-09-29 TEAM_J는 Opus(1M)에서 324k 대화로 `claude-sonnet-5-5`로 바꿨다: 창은 200k, FOB는 자동 compaction(324k → 14k)이 오기 전까지 0 %다. 전에는 1M 창에 68 % 남음으로 보였다.
- **Step 0, 데스크톱 대화 기록이 창에 대해 말하는 다른 것.** 이 기계의 대화 기록 207개로 확인했다(2026-09-29). `compactMetadata`에는 `trigger`, `preTokens`, `postTokens`, `durationMs`뿐이고 창은 없다. 200k 세션의 자동 compaction은 167k–178k, 1M 세션은 968k–974k에서 일어나 창의 신호처럼 보이지만 정확하지 않아 **쓰지 않는다**. TEAM_J가 바꾼 직후의 compaction은 324,404에서 일어났고(앞 모델의 대화), 프록시 모델은 다른 곳에서 일어난다(394k, 796k). `usage`에도 창 필드가 없다(`context_management`는 비어 있고 `iterations`는 `[]`). CLI의 모델 선택창은 `Opus 5.5 (1M context)` 같은 표시 이름(`Kept model as …`)을 적는데, id가 아니라 손대지 않는다. statusline 입력에는 `context_window.context_window_size`와 `model.id`가 있다(Claude Code 2.1.284 바이너리에서 읽음).
- **등급.** hook과 상태 폴더의 기록 형식(`fuel/<sessionId>.jsonl`, 여전히 숫자와 모델 id뿐)은 `user` 등급이다. 옛 줄(`rate_limits`만)은 전처럼 읽는다.

### 8.7 FLEET PLAN 3단계: 승인 운용

상태: 만듦(2026-09-28). SUPERVISOR 결정은 아래에 적었다. 8.6에서 그림자를 만들었다. atc가 제안하고 SUPERVISOR는 동의·반대만 하며, 아무것도 움직이지 않는다. 3단계에서는 SUPERVISOR가 승인하면 그 제안이 실행된다. 제안마다 여전히 사람이 하나씩 승인한다. 자동 STOP은 그대로 4단계이고 기본으로 꺼져 있다.

**지금 사실(2026-09-28 07:30 UTC).**

| 사실 | 값 |
|---|---|
| FLEET PLAN | 07:25 UTC부터 그림자, 판정 0/20, 열린 제안 없음 |
| 이미 있는 실행 코드 | 8.5 LAUNCH·STOP(`launchPlanOf`, `stopTargetOf`, `claude --bg`, `claude stop`), `entryIntoService`(ENTRY INTO SERVICE), `aog`·`retired`를 쓰는 `applyPatch`(AOG, RETIREMENT) |
| 다른 스위치 | DISPATCH `mode`(`POST /api/dispatch/mode`)와 SCHEDULE `mode`: 게이트 검사도 Origin 검사도 없고, FLIGHT RECORDER에 `mode:` 줄을 남긴다. AUTOLAND와 설정 창: Origin 검사(`fromThisApp`). ATFM OFF: 끄는 것은 누구나 |
| 세션 | 팀 세션 10개가 모두 데스크톱 세션, 백그라운드 0/6 |

**원칙.**

1. **승인이 곧 실행이다.** 승인 운용에서는 SUPERVISOR가 승인하면 FLEET 탭 버튼과 같은 코드로 바로 실행한다. 승인한 뒤 기다리는 상태도 없고, 중간에 OCC도 없다. 여기서 팀에 메시지를 보내는 일은 없다. LAUNCH는 8.5 버튼처럼 CREW BRIEFING을 세션의 첫 지시로 넣는다.
2. **승인할 때 다시 확인한다.** 제안은 최대 24시간 묵었을 수 있다. 최근 계획 주기(10분 이내)가 같은 AIRCRAFT에 같은 종류를 여전히 내고, 8.5의 거절 조건을 모두 통과할 때만 실행한다. 아니면 409를 돌려주고 제안은 열린 채로 둔다.
3. **SUPERVISOR만, 이 화면에서만.** 승인 운용으로 켜는 스위치와 모든 승인에는 이 화면의 Origin이 필요하다. LAUNCH·STOP·AUTOLAND와 같다. `atcctl`에는 FLEET PLAN 명령이 없어서 TOWER·OCC·CROSSCHECK·REVIEW는 승인도, 켜기도 못 한다. 그림자로 돌리는 것은 어디서든 된다. 끄는 것은 막지 않는다.
4. **게이트를 넘어야 켤 수 있다.** 그림자 게이트가 준비됐을 때만 승인 운용을 켤 수 있다(건수는 결정 참고). 블록은 계속 게이트를 보여 준다. 승인 운용에서는 승인이 동의, 거절이 반대로 센다.
5. **모든 단계가 기록에 남는다.** 제안마다 `approve` 줄 하나와, 단계별 결과를 담은 `executed` 줄 하나가 남는다. FLIGHT RECORDER에는 단계마다 `by: "FLEET PLAN F-0001"`인 `fleet` 줄이 남는다.

**종류별 실행.**

| 종류 | 승인하면 하는 일 | 승인 양식의 선택지 |
|---|---|---|
| `LAUNCH` | 제안한 AIRCRAFT를 8.5 LAUNCH | permission mode(기본 `auto`), 모델(선택) |
| `ENTRY` | ENTRY INTO SERVICE(제안한 REGISTRATION·AIRPORT·CONFIGURATION) 뒤 LAUNCH | LAUNCH와 같다. REGISTRATION을 다시 확인해 이미 쓰였으면 거절 |
| `STOP` | 8.5 STOP | 없음 |
| `RESTART` | STOP 뒤 새 CREW BRIEFING으로 LAUNCH | permission mode·모델. 그 AIRCRAFT의 마지막 LAUNCH 기록(FLIGHT RECORDER)으로 미리 채움 |
| `AOG` | 프로필 `aog: {reason: "FLEET PLAN F-0001: <사유 코드>", until}` | `until` 날짜(기본은 제안의 값) |
| `RETIRE` | 프로필 `retired: {reason: "FLEET PLAN F-0001"}`. 백그라운드 세션을 모는 AIRCRAFT면 이어서 STOP | "백그라운드 세션도 멈춤"(기본 켜짐) |
| `RETURN`(새 종류) | 프로필 `aog: null` | 없음 |

`RETURN`은 8.6의 AOG 줄에서 약속한 후속 제안이다. FLEET PLAN이 AOG로 둔 AIRCRAFT의 `until` 날짜가 지나면 RETURN을 제안한다. 사유에는 원인이 풀렸는지(살아 있는 세션, 24시간 LOS 없음) 아직 남았는지를 적는다. 여전히 NORDO인 AIRCRAFT는 AOG가 풀린 뒤 보통의 LAUNCH 후보로 다시 나온다. RETIRE는 계속 30일 규칙에서만 나온다.

**일부만 된 실행.** ENTRY와 RESTART는 두 단계다. 둘째 단계가 실패하면 첫째 단계는 된 채로 남고, `executed` 줄이 어느 단계에서 실패했는지 적는다. 그러면 AIRCRAFT가 FLEET에 들어왔지만 운항하지 않거나, 세션이 멈췄지만 다시 뜨지 않은 상태가 된다. 둘 다 카드 버튼으로 손으로 마무리한다. 실패한 실행은 제안을 `failed`로 닫되 24시간 쉬지 않는다. 그래서 다음 주기들이 다시 제안할 수 있다.

**기록과 화면.**

- `fleet-plan.jsonl`에 `{op: "approve", id, by, at, options}`와 `{op: "executed", id, at, ok, steps: [{action, ok, jobId?, error?}]}`가 더해진다. 상태는 `open → executing → executed | failed`가 되고, 거절하면 `open → disagreed`다. `executing`은 요청하는 동안만이고, id마다 잠금을 둬서 두 번 눌러도 한 번만 실행한다.
- 모드는 별도 파일 `~/.local/state/atc/fleet-plan.json`(`{mode: "shadow" | "approval"}`)에 두고 원자적으로 바꿔 쓴다. 바꿀 때마다 FLIGHT RECORDER에 `{kind: "fleet-plan", op: "mode:approval" | "mode:shadow", by}`를 남긴다. 4단계가 승인 운용 기간을 이것으로 잰다(ATFM과 같은 `approvalRunOf`).
- FLIGHT RECORDER의 `fleet` 줄에 `launch`·`stop` 말고 `entry`·`aog`·`return`·`retire` op가 더해진다.
- API:
  - `POST /api/fleet/plan/mode {mode}`: approval은 Origin과 준비된 게이트가 있어야 한다(아니면 409). shadow는 언제나 받는다.
  - `POST /api/fleet/plan/:id/approve {permissionMode?, model?, until?, stopSession?}`(Origin): `executed` 결과를 돌려준다. 그림자 모드(409), 닫힌 제안(409), 조건이 바뀐 제안(409, "조건이 바뀜")은 거절한다.
  - `GET /api/fleet/plan`에 `mode`, `approvalSince`, 열린 제안마다 `stale`(최근 주기가 더는 내지 않음)이 더해진다.
- 블록의 게이트 옆에 스위치가 생긴다. 승인 운용에서는 동의 대신 **승인(실행)** 버튼이 나온다. 누르면 무엇이 실행되는지와 위 선택지를 담은 작은 양식이 열린다. LAUNCH·ENTRY·RESTART에는 백그라운드 세션 수와 상한도 같이 보인다. 최근 제안에는 실행한 단계가 보인다.

**만든 것(2026-09-28).** 아래 1~6번. 초안이 열어 둔 것은 이렇게 정했다.

- **승인 운용의 동의.** 승인 운용에서는 동의 자리에 승인(실행)이 온다. 실행 없는 `agree` 판정은 받지 않는다(409). 거절은 그림자처럼 `disagree` 판정이다.
- **실패와 다시 시도.** 실패한 실행은 조건이 이어지는 한 다음 주기에 다시 나온다. 지속 조건 시각은 그대로 이어진다. 실행 중 서버에 예상 못 한 오류가 나면 단계 없이 `failed`로 닫아서, `executing`으로 남는 제안이 없다.
- **RESTART 시점.** RESTART는 멈춘 세션이 `claude agents`에서 빠질 때까지 5초까지 기다린 뒤 다시 띄운다.
- **끄기.** 화면 밖에서 그림자로 돌리면 기록에 `by: "API"`로 남는다.
- **보이는 곳.** 열린 목록에 `executing` 제안도 보인다. `approvalSince`는 FLIGHT RECORDER의 마지막 `mode:` 줄에서 읽는다(보존 30일).
- **7702 시험(임시 상태, 게이트를 채운 기록).**
  - Origin 없이 승인 운용을 켜려 하면 거절됐다(403). 화면에서는 켜졌고, 승인 양식에 RETIRE 체크박스가 보였다.
  - RETIRE TEAM_C를 승인하자 `approve`·`executed`가 적히고, 임시 FLEET에서 TEAM_C가 퇴역했고, FLIGHT RECORDER에 `by: "FLEET PLAN F-0022"`인 `retire` 줄이 남았다.
  - 두 번째 승인과 승인 운용 중의 `agree`는 409였다. 떼어 낸 LAUNCH·STOP도 데스크톱 세션을 여전히 거절한다.

아직 안 만든 것: 4단계(자동 STOP), FLEET PLAN 제안의 CROSSCHECK mark.

**구현 순서.**

1. ✅ 모드 파일, Origin과 게이트를 보는 스위치 API, `mode:` 줄, 블록의 스위치.
2. ✅ 순수 함수 `executionOf(proposal, latestCandidates, context)`: 실행 단계와 거절(조건이 바뀜, 모드, 8.5 거절 조건, REGISTRATION이 이미 쓰임). 종류마다, 그리고 일부만 된 실행의 테스트.
3. ✅ 8.5 핸들러를 `launchAircraft(reg, options, by)`와 `stopAircraft(reg, by)`로 떼어 내 버튼과 승인이 같이 쓴다. id별 잠금과 기록을 갖춘 승인 API.
4. ✅ 블록의 승인 양식, 최근 제안에 실행한 단계 표시.
5. ✅ 기한이 지난 FLEET PLAN AOG의 `RETURN`.
6. ✅ DOCS 안내와 CHANGELOG.

**위험.**

| 위험 | 막는 법 |
|---|---|
| 바뀐 사실 위에서 오래된 제안을 승인 | 최근 주기(10분 이내)와 8.5 거절 조건으로 다시 확인 |
| 두 번 실행(두 번 클릭, 탭 두 개) | id별 잠금, `open` → `executing` 전이는 한 번만 |
| 사용량 | 백그라운드 상한(8.5), LAUNCH마다 승인 하나. FUEL hold 수준인 ACCOUNT로는 LAUNCH·ENTRY를 제안하지 않는다(8.6, ATC-63) |
| ENTRY·RESTART가 반만 됨 | 단계마다 기록, 24시간 쉬지 않음, 카드 버튼으로 손으로 마무리 |
| 다른 세션이 승인 | 승인과 승인 운용 켜기에 Origin 검사, `atcctl` 명령 없음 |
| 승인 운용을 너무 일찍 켬 | 게이트가 준비될 때까지 스위치가 거절 |

**결정(2026-09-28, SUPERVISOR): 모두 제안대로.**

1. **켜는 조건:** 그림자 게이트 그대로(판정 20건, 80%). *ATC-273으로 바뀜: FLEET PLAN만 판정 5건, 합의율 80%(`server/fleet-plan.ts`의 `FLEET_PLAN_GATE`). 제안이 드물어서다(사흘에 판정 7건). DISPATCH·SCHEDULE 게이트는 20건·80% 그대로다.*
2. **스위치 위치:** 별도 파일 `fleet-plan.json`. DISPATCH와 FLEET PLAN을 따로 켠다.
3. **승인할 때 LAUNCH의 기본 permission mode:** `auto`. LAUNCH 버튼과 같다.
4. **RETIRE가 백그라운드 세션을 멈추나:** 기본으로 멈추고, 체크를 풀면 남긴다.
5. **실패한 실행:** 24시간 쉬지 않는다. 지속 조건을 채우면 제안이 다시 나온다.

### 8.8 AIRCRAFT health

상태: 1–6단계를 만들었다(ATC-45, ATC-47, ATC-48, ATC-51, ATC-55). 대응 매뉴얼과 pull 분류기, push hook, health에서 나오는 FLEET PLAN 제안, ACCOUNT로 붙드는 `LIMIT`, ACCOUNT별 FUEL REMAINING이다. 이벤트로 읽는 상태도 만들었다(ATC-86): 한도로 끊긴 `LIMIT`, reset 뒤 `RESUME`, `STALLED` FLIGHT이고, 그동안 FLEET 줄에 FLIGHT가 남는다. DISPATCH는 아직 이들에게도 제안한다(ATC-90).

**왜.** 2026-09-28 07:37:13Z에 TEAM_H가 ATC-44 BRIEF를 받고 3초 뒤 계정의 session limit에 걸렸다. 07:40:57Z에 누가 "Try again"을 칠 때까지 atc는 TEAM_H를 `idle`로 보여서, FLEET·DISPATCH·TOWER 모두 일을 받을 수 있는 AIRCRAFT로 봤다. atc는 `dead`·`busy`·`idle`만 알았고, 세션이 왜 멈췄는지, 무엇을 기다리는지는 읽지 않았다.

**지금 사실.**

- 실패한 턴은 대화 기록에 `isApiErrorMessage: true`인 `assistant` 줄로 남는다. `error` 코드(`rate_limit`, `server_error`, `model_not_found`, `invalid_request`, `unknown` …)와 글 한 줄이 있다. 사용 한도 줄에는 `quotaLimits`도 있어서 `resetsAt`(epoch 초)과 `rateLimitType`(`five_hour` …)을 읽을 수 있다.
- 턴을 여는 `user` 줄에는 `turnOrigin`이 있다. 다른 세션이 보낸 메시지(BRIEF)는 `isMeta: true`이고 `origin.kind: "peer"`다.
- 자동 모드 거부와 hook 막힘은 `is_error`인 `tool_result`이고, 글이 "Permission for this action was denied …"나 "PreToolUse:<도구> hook error"로 시작한다.
- 2026-09-24~28의 대화 기록 162개: `server_error`(SSL) 58, session limit 58, `model_not_found` 11, provider 오류 12, "Prompt is too long" 3, 서버 쪽 제한 3. 자동 모드 거부 81, hook 막힘 75.

**원칙.**

- 알리고 제안만 한다. atc는 팀 세션에 다시 보내기·승인을 하지 않고, 세션을 스스로 다른 계정으로 옮기지도 않는다. 제안하는 것은 `ACCOUNT CHANGE`(8.6)다: 가득 찬 ACCOUNT에서 STOP, 여유 있는 ACCOUNT에서 CREW BRIEFING으로 LAUNCH. FLIGHT 사이에만, SUPERVISOR가 승인할 때만 한다. FLIGHT 도중 한도로 잘린 세션은 옮기지 않고 같은 ACCOUNT의 RESUME으로 둔다(ATC-86, ATC-129). [accounts.md](accounts.md) 5.3 참고.
- 상태가 아니라 원인을 보인다. 코드마다 오류 한 줄, 시작 시각, 매뉴얼의 다음 한 걸음이 붙는다.
- 기계 단위와 AIRCRAFT 단위를 가른다. `NETWORK`는 기계에 한 번 올린다. `LIMIT`은 SUPERVISOR가 ACCOUNT 라벨을 달았으면 ACCOUNT마다 한 번(ATC-51), 아니면 reset 시각(같은 계정 창)마다 한 번 올린다.
- 코드, 시각, 오류 한 줄만 둔다. 본문은 두지 않는다. 살아 있는 세션의 대화 기록 끝 64KB만 읽고, 크기나 시각이 바뀔 때만 다시 읽는다.
- push와 pull이 같은 규칙을 쓴다. 대화 기록의 마지막 사실보다 새 push 기록만 쓰고, hook도 `StopFailure.error`를 같은 `classifyError`로 옮긴다.
- 모르면 틀린 코드 대신 `UNKNOWN`과 오류 원문 한 줄.

**코드와 대응 매뉴얼** (`server/health.ts`, 순수 함수 `healthOf`)

| 코드 | 무엇으로 아나 | 수준 | DISPATCH·SCHEDULE | 누가, 어떻게 |
|---|---|---|---|---|
| `LIMIT` | 사용 한도 문구의 `rate_limit`. `resetsAt`은 `quotaLimits`에서, 없으면 "resets 7:40am (UTC)"에서 | ALERT, ACCOUNT마다 한 번(라벨이 없으면 reset 시각마다) | `resetsAt`까지 뺀다. 같은 ACCOUNT의 다른 AIRCRAFT도 | 기다린다. reset 뒤에도 지시가 대답을 못 받았으면 `UNANSWERED`로 바뀐다. 지시를 보낸 쪽(OCC·사용자)이나 SUPERVISOR가 다시 보낸다 |
| `LIMIT`(cut) | idle이고, 마지막 지시와 마지막 `release` 뒤에 `usageLimitNote: "wrap_up"` 줄이 있고, 그 뒤 API 오류가 없다(ATC-86): 오류 줄 없이 턴이 정상으로 끝났다. 표시 `HOLD · LIMIT (cut 18:10Z)`, 알면 ACCOUNT의 FUEL 기록에서 `resetsAt` | ALERT, ACCOUNT마다 한 번 | `LIMIT`과 같다 | 기다린다. reset 뒤에도 새 지시가 없으면 `RESUME`으로 바뀐다 |
| `RESUME` | reset이 지난 cut `LIMIT`이고 그 뒤 새 활동이 없다(ATC-86). 표시 `RESUME 필요` | ALERT | — (표시만) | SUPERVISOR가 그 세션에서 "계속"을 보낸다. atc는 팀에 메시지를 보내지 않는다 |
| `STALLED` | `stalledMin`(60분) 넘게 idle이고, In Progress FLIGHT(STAND 점유나 `tail:` 라벨)를 쥐었는데 열린 PR이 없고, 다른 코드가 없다(ATC-86) | INFO | — (표시만) | SUPERVISOR가 그 세션을 들여다본다: 막힌 것이 없으면 "계속", 되살릴 수 없으면 RESTART |
| `THROTTLE` | `rate_limit` "not your usage limit", overloaded, 그 밖의 `server_error` | INFO, 30분에 3번이면 ALERT | — | 몇 분 뒤 다시 보낸다. 10분 넘게 대답이 없으면 `UNANSWERED`로 바뀐다 |
| `NETWORK` | "Unable to connect", SSL·TLS, 연결 오류 | ALERT, 기계에 한 번 | — | SUPERVISOR가 네트워크·프록시·`ANTHROPIC_BASE_URL`/`NO_PROXY`를 보고 다시 보낸다 |
| `MODEL` | `model_not_found` | ALERT | 뺀다 | SUPERVISOR가 모델이나 경로를 고쳐 다시 띄운다. 그대로 재시도하지 않는다 |
| `CONTEXT` | "Prompt is too long", compaction 실패 | ALERT | 뺀다 | 새 CREW BRIEFING으로 RESTART. STAND와 PR은 HANDOFF |
| `PROVIDER` | OpenAI 호환 경로의 `unknown` 오류(400 schema, `name` 길이, 본문 없는 상태 코드) | ALERT | 뺀다 | 기본 경로로 다시 띄우고, 그 경로의 버그를 올린다 |
| `PENDING` | idle인데 마지막 대답의 `tool_use`에 `tool_result`가 없음. push: `permission_prompt`·`elicitation_dialog` 알림(세션 파일이 `busy`여도) | INFO | — | SUPERVISOR가 그 세션에서 승인하거나 거절한다 |
| `UNANSWERED` | idle이고, 턴을 연 마지막 지시에 10분 동안 대답이 없음(`LIMIT`·`THROTTLE`이 대답 없이 끝난 경우도) | ALERT | — | 지시를 보낸 쪽(OCC·사용자)이나 SUPERVISOR가 다시 보낸다. atc는 보내지 않는다 |
| `HUNG` | busy인데 30분 동안 기록이 없음 | INFO, 60분이면 ALERT | 뺀다 | SUPERVISOR가 들여다본다. 계속되면 RESTART |
| `DENIED` | 10분 안에 거부·hook 막힘 3번 이상 | INFO | — | SUPERVISOR가 permission 규칙으로 허용하거나 다시 브리핑한다 |
| `UNKNOWN` | 그 밖의 API 오류 | ALERT | — | SUPERVISOR가 오류 한 줄을 보고 판단한다 |
| `NORDO` | 프로세스 없음(8.6, 그대로) | — | — | 전과 같다(FLEET PLAN AOG·LAUNCH) |

- 코드는 다음 대답이 오거나, 오류 뒤 새 지시가 오면 풀린다. push hook도 `Stop`·`PostToolUse`에 코드 없는 줄을 남겨 push 코드를 푼다.
- 임계값은 기본값이다. 서비스는 `ATC_HEALTH_UNANSWERED_MIN`, `ATC_HEALTH_HUNG_MIN`, `ATC_HEALTH_HUNG_ALERT_MIN`, `ATC_HEALTH_THROTTLE_ALERT_COUNT`, `ATC_HEALTH_THROTTLE_WINDOW_MIN`, `ATC_HEALTH_DENIED_COUNT`, `ATC_HEALTH_DENIED_WINDOW_MIN`을 읽는다.

**ACCOUNT(ATC-51, [fuel.md](fuel.md) 6절).** 사용 한도는 AIRCRAFT 하나가 아니라 계정의 것이다. SUPERVISOR가 AIRCRAFT마다 어느 계정으로 나는지 `fleet.json`의 선택 항목 `account`로 적는다(FLEET 카드에서 고침. 소문자·숫자·`-`, 예: `main`, `pro-2`. email은 쓰지 않는다). atc는 계정을 알아내려고 자격 증명이나 계정 설정을 읽지 않는다.

- 라벨이 없는 AIRCRAFT는 기본 계정(`default`)으로 센다. 라벨이 달린 AIRCRAFT가 하나도 없으면 atc는 계정을 모른다: `LIMIT`은 전처럼 reset 시각으로 묶고, 다른 AIRCRAFT는 붙들지 않는다.
- 한 AIRCRAFT의 `LIMIT`은 같은 ACCOUNT의 살아 있는 다른 AIRCRAFT 모두를 그 reset까지 붙든다(그 계정에서 여럿이 걸렸으면 가장 늦은 reset까지, reset을 모르면 `LIMIT`이 풀릴 때까지). DISPATCH는 STAND 없는 FLIGHT까지 그들을 건너뛰고, SCHEDULE NEW는 tail로 받지 않는다. 사유는 `HOLD · LIMIT (account pro-2) until 07:40Z — 같은 ACCOUNT의 TEAM_K가 사용 한도에 걸림`.
- 붙들린 형제는 자기 health 코드를 받지 않는다(멈춘 것이 아니다). 그래서 따로 경보나 FLEET PLAN 제안이 나오지 않는다. 그 ACCOUNT의 `LIMIT` 경보 하나가 그들을 적는다: `LIMIT (account pro-2) — TEAM_K 사용 한도, reset 07:40Z까지 HOLD · 같은 ACCOUNT도 HOLD: TEAM_L`.
- AIRCRAFT가 아닌 세션(ENGINEERING 같은 관제 세션이나 그 밖의 세션)의 `LIMIT`은 전처럼 reset 시각으로 묶고, AIRCRAFT를 붙들지 않는다. 관제 세션도 FUEL을 위해 ACCOUNT 라벨을 가질 수 있지만(ATC-60, 아래) 이 `LIMIT` 규칙은 그대로다.

**FUEL REMAINING(ATC-55, [fuel.md](fuel.md) 6절).** `LIMIT`은 계정이 바닥났다는 것이고, FUEL은 얼마나 가까운지다. SUPERVISOR가 설치하는 statusline 명령 `hooks/fuel-statusline.mjs`([hooks/README.ko.md](../hooks/README.ko.md#fuel-statusline))가 Claude Code가 상태 줄에 넘기는 `rate_limits`(`five_hour`, `seven_day`, `spend_limit`: 쓴 몫과 reset)를 숫자만 `fuel/<sessionId>.jsonl`에 덧붙인다.

- 서버는 session → AIRCRAFT → ACCOUNT로 잇고 ACCOUNT마다 가장 새 값을 쓴다. 그래서 자기 세션이 보고하지 않은 AIRCRAFT도 그 ACCOUNT의 값을 보인다. ACCOUNT가 없으면 그 AIRCRAFT 자신의 세션 값만 쓴다. reset이 지난 창은 뺀다.
- 관제 세션(TOWER, OCC, MCC, ENGINEERING, ATC-60. CROSSCHECK는 ATC-371로 은퇴)도 ACCOUNT의 구성원이다. SUPERVISOR가 설정 창(AGENTS 탭 CONTROL 블록, `fleet.json` `control`, 선택 항목)에서 라벨을 단다. 라벨이 없으면 라벨이 하나라도 있을 때 `default`로, 하나도 없으면 자기 이름으로 따로 센다. 그 기록은 ACCOUNT의 값, TOWER INFO, 그 ACCOUNT의 AIRCRAFT에 대한 DISPATCH HOLD에 들어간다. 관제 세션 자신은 붙들지 않는다. FLEET 탭의 FUEL 블록이 ACCOUNT마다 AIRCRAFT와, 따로 관제 세션을 적는다.
- FLEET FUEL 블록과 카드: ACCOUNT마다 `사용 82% · resets 21:00Z` — 가장 많이 쓴 창에서 **쓴 몫**과 그 창의 reset(ATC-81: 늘 쓴 몫이라고 적는다. "FUEL 82%"는 남은 눈금처럼 읽혔다). 80 % 아래는 회색, 80 %부터 노랑(INFO), 95 %부터 빨강(HOLD 임계값). 툴팁에 창마다의 값과 어느 세션이 언제 적었는지가 있다. 목록 줄에는 싣지 않는다. 같은 ACCOUNT의 AIRCRAFT마다 같은 숫자가 자기 것처럼 보이기 때문이다. 줄에는 AIRCRAFT 자기 연료 FOB(아래 "FOB as built (ATC-81)")를 두고, ACCOUNT는 hold 수준일 때 꼬리표 `HOLD · FUEL (account pro-2) until 21:00Z`(백분율 없이)로만 둔다.
- 80 %(`dispatch.json` `fuel.infoPct`)부터 TOWER 브리핑 `open.fuel`에 INFO 항목(ACCOUNT·창·reset마다 한 번), 그 ACCOUNT의 AIRCRAFT가 쥔 FLIGHT의 FLIGHT FOLLOWING에 `fuel` 문제(`info`)가 생긴다.
- 95 %(`fuel.holdPct`)부터는 SUPERVISOR가 DISPATCH HOLD 스위치를 켰을 **때만**(설정 창 AUTOMATION 탭 FUEL 블록, `fuel.hold`, 기본 꺼짐, 결정 D3) DISPATCH가 그 ACCOUNT의 AIRCRAFT를 reset까지 `HOLD · FUEL (account pro-2) until 21:00Z`로 건너뛴다. SCHEDULE NEW는 그대로다. 계정을 저절로 바꾸는 일은 없다.

**Push(`hooks/health.mjs`, ATC-47).** Claude Code hook이 멈춘 순간을 바로 알려서, 승인을 기다리는 세션이 30분 뒤 `HUNG`이 아니라 곧바로 `PENDING`으로 보인다. 이벤트마다 상태 폴더의 `health/<sessionId>.jsonl`에 한 줄을 덧붙인다: `{t, event, code?, error?, line?}`(`StopFailure`, `Notification`, `Stop`, `PostToolUse`. 코드·시각·오류 첫 줄만, 본문 없음). 서버는 세션마다 마지막 줄을 읽고, 대화 기록의 마지막 사실보다 새 push 기록이 이긴다(`mergeHealth`). 아니면 pull 결과가 그대로 선다. SUPERVISOR의 설치 방법은 [hooks/README.ko.md](hooks/README.ko.md)에 있다.

**어디에 보이나.**

- `/api/snapshot`: `sessions[].health`(`code`, `level`, `since`, `resetsAt`, `detail`, `next`, `holds`)와, ALERT 코드마다 kind `health`인 `alerts`. 올라가고 풀린 경보는 다른 경보처럼 `alert.raised`·`alert.cleared` 이벤트와 FLIGHT RECORDER 줄이 된다.
- FLEET 운항 상태 목록: FLYING 칸 앞의 표시. 예: `HOLD · LIMIT until 07:40Z`, `PENDING approval 12m`, `CONTEXT — RESTART`. 툴팁에 오류 한 줄과 다음 한 걸음이 있다. ACCOUNT로 붙들린 AIRCRAFT는 점선 표시 `HOLD · LIMIT (account pro-2) until 07:40Z`, 라벨을 단 ACCOUNT는 REGISTRATION 옆 작은 칩으로 보인다. 카드에는 ACCOUNT 줄과 같은 HOLD 줄이 있다.
- DISPATCH는 막는 코드(`LIMIT`, `MODEL`, `CONTEXT`, `PROVIDER`, `HUNG`)의 AIRCRAFT와 ACCOUNT로 붙들린 AIRCRAFT를 그 표시를 사유로 건너뛴다. SCHEDULE NEW는 그 AIRCRAFT를 tail로 받지 않는다. FUEL 스위치가 켜져 있으면 95 % 이상인 ACCOUNT도 건너뛴다(위).
- FLIGHT FOLLOWING: 그 AIRCRAFT가 쥔 FLIGHT에 `health` 문제(ALERT면 `warn`, 아니면 `info`). OCC가 다른 문제처럼 보고한다.
- TOWER 브리핑: `open.health`(코드가 있는 AIRCRAFT 전부)와 `open.healthAlerts`.

#### CAPTAIN 보고 판정 구현 (ATC-89)

[6.1](#61-판정-계열jev)의 판정 계열이 atc AIRCRAFT의 턴이 어떻게 끝났는지도 읽는다. Stop 때(세션이 `idle`이고 마지막 활동이 바뀜) Jev가 CAPTAIN의 마지막 메시지를 Choice 하나로 분류한다: `done`(끝났다고 보고, PR이나 결과 포함), `decision`(SUPERVISOR의 결정을 청함), `stopped`(일하다 멈춤), `ready`(놀고 있고 준비됨), `unknown`(알 수 없음). health 코드, DISPATCH, FLEET PLAN은 바꾸지 않는다. hook도 필요 없다: 서버가 세션 파일로 턴의 끝을 보고 판정할 때 대화 기록에서 메시지를 읽는다.

- **읽는 것.** AIRCRAFT(`TEAM_*`)이고 작업 폴더가 `ATCC` AIRPORT에 속한 세션만이고, 그 확인이 어떤 읽기보다 먼저다: 그 밖의 세션(vocado AIRCRAFT, 관제 세션)은 대화 기록을 열지도 않는다. 대화 기록 끝 128 KB만 읽어, 글로 끝난(`tool_use`가 아닌) 마지막 `assistant` 줄 가운데 뒤에 새 지시가 없는 것을 본다.
- **보내는 것.** 경로, URL, 이메일, 토큰 같은 글자열을 `<path>`, `<url>`, `<email>`, `<token>`으로 바꾼 메시지를 끝에서 1,500자까지(결론과 질문은 끝에 온다). 메시지는 저장하지 않는다: 기록에는 `sent: {chars}`만 남는다.
- **스위치와 한도.** 같은 `judges.jev`다: `off`면 아무것도 읽거나 보내지 않는다. `shadow`는 서버가 도는 동안 끝난 턴을 판정한다(처음 본 세션은 기준선만 적음). `replay`는 처음 볼 때 이미 idle인 세션의 마지막 턴도 판정한다. 1분 3건 한도는 CLASSIFY, DISPATCH와 나눠 쓰고 셋이 번갈아 뽑는다.
- **기록.** `judges.jsonl`에 `target: "report"`인 `judge` 줄: `id`(`R-<세션 8자>-<메시지 시각>`), `session`, `aircraft`, `turnAt`, `judgment`(`class`, `probabilities`, `confidence`), `sent`. SUPERVISOR의 표시는 `mark` 줄(`target: "report"`, `id`, `verdict: right|wrong`)이다.
- **화면.** FLEET 줄에 분류 칩(결정 필요 확률이 문턱 이상이면 앰버), 툴팁에 확률. AIRCRAFT 카드에 `JEV REPORT` 줄과 SUPERVISOR용 **맞음 / 틀림** 버튼(스위치처럼 이 화면 Origin만, 관제 세션은 표시할 수 없다). FLEET PLAN 패널 위쪽 줄에 `JEV REPORT 맞음 m/n`. 어떤 게이트에도 세지 않는다. 세션이 다시 busy가 되면 칩은 사라진다.
- **FLIGHT FOLLOWING.** `decision` 확률이 문턱(`judges.json`의 `reportDecisionMin`, 기본 0.7) 이상이면 그 AIRCRAFT가 쥔 FLIGHT에 `report` 문제(`info`) 하나가 붙는다. 턴마다 한 번(key에 판정한 턴), 세션이 아직 idle일 때만.

PILOT'S DISCRETION(ATC-89): 표시 버튼은 행 툴팁이 아니라 카드에 둔다(툴팁에는 버튼을 못 넣고 행 자체가 버튼이다). 표시로 믿을 만하다고 나오기 전까지 문제는 `info`(OCC LOG만)다. 턴의 끝은 세션 상태로 보므로 hook(`user` 등급)은 바꾸지 않았다.

#### CAPTAIN 보고 판정, 규칙 먼저와 넓은 입력 구현 (ATC-141)

- **규칙 먼저.** 사용 한도로 잘린 턴(ATC-86과 같은 검사: 마지막 지시와 마지막 `release` 뒤에 `usageLimitNote: "wrap_up"` 줄)은 `engine: "rule"`, `reason: "limit-cut"`, `sent: {chars: 0}`인 `stopped`로 기록한다. Jev를 부르지 않고 아무것도 보내지 않는다. 기록 모양은 그대로라 툴팁·표시·일치율이 전처럼 돈다.
- **입력.** 마스킹한 메시지가 1,500자보다 길면 앞 500자와 뒤 1,000자를 " … "로 이어 보낸다(앞은 턴이 어떻게 시작했는지, 뒤는 어떻게 끝났는지). 상한은 그대로다.
- **기준.** `decision`은 "지금 결정·승인·선택을 SUPERVISOR에게 청하고 그 답을 기다린다"이고, 나중을 위한 메모("설치 뒤 확인", "SUPERVISOR가 머지")는 결정이 아니다. `stopped`에 "사용 한도로 잘림"이 들어간다. "둘 다면 decision"은 그 청이 일을 막을 때만 적용한다.
- **점검.** `node --env-file=<env> server/judges/report-rerun.ts [--all] [--rule-only] [--only R-…]`가 기록된 판정을 그림자로 다시 돌리고(`judges.jsonl`을 읽기만 하며, 마스킹한 ATCC 메시지만 보낸다) 전후 일치율을 낸다. R-29953b2d-1790672807은 규칙으로 `stopped`가 된다.

**구현 순서.**

1. ✅ 설계와 매뉴얼: 이 절, `controller/CLAUDE.md`의 TOWER 줄, OCC FOLLOWING 줄, `docs/guide/`.
2. ✅ Pull: 순수 함수 `factsOf`·`healthOf`, 기계 단위로 묶는 `healthAlerts`, 실제 대화 기록 줄 모양으로 만든 테스트(TEAM_H 재생 포함). snapshot, FLEET 줄, FLIGHT FOLLOWING, TOWER 브리핑, DISPATCH·SCHEDULE 거르기.
3. ✅ Push: `StopFailure`와 `Notification`(`permission_prompt`, `idle_prompt`, `elicitation_dialog`)에 거는 `hooks/health.mjs`. `Stop`·`PostToolUse`에 풀고, 상태 폴더의 `health/<sessionId>.jsonl`에 덧붙인다. `user` 등급.
4. ✅ FLEET PLAN 제안(ATC-48): `MODEL`과 주간 `LIMIT`에 AOG(reset 날까지), `CONTEXT`와 ALERT 수준의 `HUNG`에 RESTART. 사유에 health 한 줄과 다음 할 일이 붙고, 코드가 풀리면 제안은 expire된다. health 경보는 이미 `alert.raised`·`alert.cleared`로 FLIGHT RECORDER에 남아서 `health.*` 줄은 따로 두지 않는다.
5. ✅ ACCOUNT(ATC-51): 프로필 항목 `account`와 FLEET 카드 입력, ACCOUNT로 묶는 `LIMIT` 경보, DISPATCH·SCHEDULE NEW·FLEET 줄의 형제 HOLD(순수 함수 `accountHolds`).
6. ✅ FUEL REMAINING(ATC-55): statusline 명령, FLEET 줄의 ACCOUNT별 값, TOWER `open.fuel`, FOLLOWING `fuel` 문제, DISPATCH HOLD 스위치(순수 함수 `fuelRemainingOf`, `fuelHolds`). `user` 등급(`hooks/`, 설정). ATC-60이 관제 세션을 ACCOUNT 구성원으로 더하고(`fuelAccountsOf`, `fleet.json` `control`) FLEET FUEL 블록을 만들었다.

**위험.**

| 위험 | 대응 |
|---|---|
| 대화 기록 형식은 공개 API가 아니다 | 순수 분류기 하나와 테스트. 모르는 오류는 원문과 함께 `UNKNOWN` |
| 대화 기록을 읽으면 지시 본문이 보인다 | 코드, 시각, 오류 한 줄만 남긴다 |
| 긴 테스트 중의 잘못된 `HUNG` | 먼저 INFO. DISPATCH는 막지만 busy AIRCRAFT는 원래 배정받지 않는다 |
| 세션 파일이 `busy`인 채 승인을 기다리면 hook이 없을 때 30분 뒤 `HUNG`으로 보인다 | push hook(3단계)이 `PENDING`을 바로 알린다. hook이 없어도 세션이 `idle`이 되면 pull이 멈춘 도구 호출을 잡는다 |

FLEET PLAN 블록의 FUEL(8.6의 "주간 사용량 줄")은 만들었다(ATC-63).

**PILOT'S DISCRETION(ATC-45).**

- `LIMIT`은 ALERT로 두고 reset 시각끼리 묶는다. 같은 계정의 세션은 창이 같고, atc는 계정을 모른다.

**PILOT'S DISCRETION(ATC-51).**

- "라벨이 있다"는 `fleet.json`에서 AIRCRAFT 하나라도 `account`를 가졌다는 뜻이다(ATC-60부터는 관제 세션의 `control` 라벨도 센다). 그 전에는 아무것도 바뀌지 않아서, 라벨을 쓰지 않는 FLEET은 ATC-45 동작 그대로다.
- 기본 계정 이름은 `default`. FLEET 줄의 칩은 라벨을 직접 단 AIRCRAFT에만 보이고, 카드는 `default`에 기본값 표시를 붙인다.
- 라벨은 소문자·숫자·`-` 1–24자이고 소문자로 저장한다. `@`가 들어가지 않으므로 email은 저장되지 않는다.
- 한 ACCOUNT에서 여럿이 걸리면 형제는 알려진 가장 늦은 reset까지 붙들리고, 경보도 그 reset을 보인다.
- ACCOUNT 경보의 키는 `health|LIMIT|account:<라벨>`이라, 두 번째 AIRCRAFT가 걸려도 새 경보가 올라가지 않는다.
- `DENIED`는 STAND가 아니라 세션마다 센다. 세션은 한 번에 STAND 하나를 쥔다.
- `NETWORK`, `UNANSWERED`, `UNKNOWN`은 DISPATCH를 막지 않는다(명세 목록에 없음). 다음 지시는 통할 수 있다.
- `THROTTLE`과 reset이 지난 `LIMIT`은 `UNANSWERED`로 바뀐다. 대답 못 받은 BRIEF가 지난 코드 뒤에 숨지 않게.

### AIRCRAFT health from events as built (ATC-86)

2026-09-28 18:10Z에 TEAM_G와 TEAM_H가 사용 한도로 멈춘 채 일곱 시간 동안 아무도 몰랐다: 오류 줄도 `StopFailure`도 없었고, 줄은 평범한 `idle`이었고, FLEET 줄에는 FLIGHT가 없었다. ATC-86은 AIRCRAFT의 상태가 그 이벤트(대화 기록 줄, hook 기록, 알려진 reset 시각)를 따르게 해서 아무도 확인하지 않아도 되게 한다. 세션을 폴링하지 않는다.

**Step 0, G와 H의 대화 기록에서(2026-09-29).**

- **한도로 잘린 표시.** 한도에 닿으면 Claude Code가 `isMeta: true`, `turnCompanion: true`, `usageLimitNote: "wrap_up"`인 `user` 줄을 쓴다(G 18:10:48Z, H 18:10:15Z). 본문은 짧은 여유(grace)가 남았으니 마무리하라는 안내다. 그 뒤 턴은 정상 `Stop`으로 끝난다(G 18:11:06Z, H 18:10:39Z). `isApiErrorMessage` 줄도 `StopFailure`도 없어서 hook도 pull 분류기도 평범한 idle로 보았다. 사람이 돌아오면 다음 지시(G 09-29 01:33:25Z, H 01:36:56Z) 뒤에 `usageLimitNote: "release"` 줄이 온다. 전체 대화 기록에서 `wrap_up` 9줄, `release` 4줄이고 모두 `user` 줄이다. 안내에는 reset 시각이 없다.
- **atc가 보는 길: pull 분류기.** `factsOf`가 그 줄을 시각과 종류(`limit-note`, `wrap_up`·`release`)만 있는 사실로 옮긴다. 본문은 읽지도 남기지도 않는다. `Stop` hook이 대화 기록 끝을 확인하는 길은 택하지 않았다: 서버가 이미 끝을 바뀔 때마다 읽고, 대화 기록을 여는 hook은 세션을 막을 위험이 있고, hook 변경은 SUPERVISOR가 머지하고 다시 설치한 세션에만 닿고, 분류기가 하나여야 push와 pull이 어긋나지 않는다. hook은 새 활동 이벤트만 더 기록한다(아래).
- **FLEET 줄이 FLIGHT를 잃은 까닭.** 줄의 FLIGHT는 그 세션이 쥔 STAND, 곧 active hook 점유다. 점유의 `lastAt`은 파일 mtime이고, 스냅샷은 `ATC_CLAIM_TTL_MIN`(180분)보다 오래된 점유를 뺀다. G의 점유는 18:10:58Z에 마지막으로 갱신되어 21:10Z부터 줄이 `flights: []`였다. FLIGHT를 붙들어 둔 것이 달리 없었다: `tail:` 라벨은 Linear 이슈에 있고 줄은 그것을 읽지 않았다. hook은 다 기록했는데 스냅샷이 놓았다.
- **`quota_auto_resume_*`.** CLI 세션에서만 보인다: `cli` 대화 기록에 `informational` 줄 열 개("Usage limit reached · continuing automatically at 7:40am", "Usage limit reset · continuing automatically"), `claude-desktop` 대화 기록 162개에는 없다. notification 종류(`quota_auto_resume_fired`·`_stale`·`_disabled`)는 Claude Code 2.1.284에 있지만 hook이 `idle_prompt`와 승인 프롬프트 말고는 버려서 `health/`로는 일어났는지 알 수 없다. ATC-86부터 셋 다 기록한다. 여기 데스크톱 세션은 자동으로 이어가지 않으므로 그쪽에서는 `RESUME`이 중요한 상태다.

**상태** (순수 함수, `server/health.ts`. 표시한 곳 말고는 `hooks/`와 무관).

- **`cut: true`인 `LIMIT`.** 세션이 idle이고, 마지막 지시와 마지막 `release` 뒤에 `wrap_up` 안내가 들어왔고, 그 뒤 API 오류가 없다. ALERT이고 다른 `LIMIT`처럼 hold다: DISPATCH가 건너뛰고 같은 ACCOUNT의 다른 AIRCRAFT를 reset까지 붙든다(reset을 모르면 코드가 풀릴 때까지). 표시 `HOLD · LIMIT (cut 18:10Z)`, reset을 알면 `until 23:10Z`가 붙는다. **reset**은 안내에 없어서 `cutResetOf`가 ACCOUNT의 FUEL 기록에서 찾는다. ACCOUNT의 세션마다 잘린 시각 직전(5분 뒤까지)의 statusline 기록을 하나씩 고르고, 그 가운데 `holdPct`(95 %) 이상 쓴 창으로서 그때 reset이 아직 오지 않은 것, 여럿이면 가장 늦은 reset을 쓴다. 지금의 FUEL REMAINING 값이 아니라 기록을 쓰는 까닭은, FUEL REMAINING이 reset이 지난 창을 버리기 때문이다. ACCOUNT에 CLI 세션이 없으면(데스크톱 세션은 statusline 기록을 쓰지 않는다) reset을 모른 채 다시 쓰일 때까지 `LIMIT (cut)`으로 남는다.
- **`RESUME`.** reset이 지난 cut `LIMIT`이고 새 활동이 없다. ALERT이고 `holds: false`, 표시만 한다. 표시 `RESUME 필요`. 매뉴얼의 다음 한 걸음: SUPERVISOR가 그 세션에서 "계속"을 보낸다. atc는 팀에 메시지를 보내지 않는다.
- **`STALLED`.** 살아 있는 세션이 `stalledMin`(기본 60, `ATC_HEALTH_STALLED_MIN`) 넘게 idle이고, In Progress FLIGHT(Linear `started`이고, 그 세션의 STAND 점유나 그 팀 이름의 `tail:` 라벨)를 쥐었는데 열린 PR이 없고, 다른 코드가 없다. INFO, 표시만. PR을 열지 않는 FLIGHT(SURVEY, CHECK)는 세지 않는다. 표시 `STALLED 1h20m`.
- **새 활동은 셋을 모두 푼다.** 대화 기록의 지시(다른 세션의 메시지도 늘 그렇듯 지시다), `release` 줄, 그리고 대화 기록이 따라오기 전에는 hook의 `UserPromptSubmit`·`PostToolUse` 기록. `Stop`은 cut을 풀지 않는다: 잘린 턴 자신의 끝이다. `quota_auto_resume_fired`는 `RESUME`을 푼다. `STALLED`는 세션의 활동 시각이 움직이면 풀린다.
- reset과 `RESUME`은 이벤트 시각과 기록된 reset 시각에서 스냅샷마다 계산한다. 세션에 핑을 보내지 않는다.

**FLEET 줄이 FLIGHT를 쥔다.** 이 세 상태의 AIRCRAFT는, 더는 새 STAND 점유가 없는 FLIGHT를 스냅샷이 `sessions[].keptFlights`에 둔다: `tail:` 라벨이 붙은 In Progress FLIGHT와, 오래된 점유가 가리키는 FLIGHT 중 Linear 이슈가 Done·Canceled가 아닌 것. `GET /api/fleet`은 이것을 STAND를 쥔 FLIGHT 뒤에 `flights`로 싣고 `kept: true`를 붙이며, 거기 모든 FLIGHT에 `detail: {commit: {sha, at} | null, pushed: boolean | null, pr: {number, url, draft} | null}`이 붙는다: 그 FLIGHT 워크트리의 마지막 커밋, `origin/<branch>`가 그 커밋과 같은가(추적 ref라 push하는 즉시 반영), 열린 PR(없으면 `null`). `flying`(지금 쥔 STAND)은 그대로여서 FLEET PLAN과 SCHEDULE은 전과 같은 것을 본다. 줄은 HOLDING이고 표시 옆에 FLIGHT와 `59a9fdc 7h ago · pushed · no PR`(push 안 됐으면 amber)를 보이며, 카드는 `HOLDING ATC-72`와 같은 줄을 적는다.

**그 밖의 곳.** FLIGHT FOLLOWING은 이미 FLIGHT를 쥔 AIRCRAFT의 `health` 문제를 올리는데, 이제 새 코드가 들어간다(cut `LIMIT`과 `RESUME`은 `warn`, `STALLED`는 `info`, 코드마다 key가 달라 바뀌면 다시 보고한다). TOWER 브리핑의 `open.health`가 표시와 다음 한 걸음을 싣고, `open.healthAlerts`에 `LIMIT (cut …)`·`RESUME` 경보가 들어간다. OCC FOLLOWING 매뉴얼에 새 코드 둘이 적힌다. DISPATCH는 cut `LIMIT`을 `LIMIT`처럼(이미 hold) 다루고, `RESUME`·`STALLED`는 DISPATCH·SCHEDULE·FLEET PLAN에 아무 영향이 없다. SUPERVISOR에게 알림을 보내는 일은 별도 이슈다.

**hook(`user` 등급).** `hooks/health.mjs`가 `UserPromptSubmit`(푼다)과 `Notification` `quota_auto_resume_fired`·`_stale`·`_disabled`(코드 없이 시각만)를 기록한다. SUPERVISOR가 `~/.claude/settings.json`의 matcher에 `UserPromptSubmit`과 세 notification 종류를 더한다([hooks/README.ko.md](../hooks/README.ko.md)). 그때까지는 대화 기록만으로 모든 상태가 돌고, 빠른 해제와 `fired`만 빠진다. 기록에는 코드와 시각만 둔다. `last_assistant_message`, 지시, 대화 기록 글은 남기지 않는다.

**Pilot's discretion (ATC-86).**

- `RESUME`은 ALERT, `STALLED`는 INFO다: `RESUME`은 늘 SUPERVISOR가 필요하고, 열린 FLIGHT가 있는데 PR 없이 쉬는 세션은 흔히 결정을 기다리는 중이다.
- reset을 모르는 cut은 reset을 모르는 다른 `LIMIT`처럼 세션이 다시 쓰일 때까지 hold다. 조용한 ACCOUNT에 너무 엄하면 짐작이 아니라 라벨을 단 ACCOUNT와 CLI 세션으로 고친다.
- `tail:` 라벨이 붙은 In Progress FLIGHT는 점유가 없어도 쥔 것으로 센다. SURVEY·CHECK FLIGHT는 PR을 열지 않으므로 `STALLED`에서 뺀다.
- `RESUME`·`STALLED`는 hold가 아니다: 한도가 풀린 AIRCRAFT는 새 배정을 받을 수 있고, 그 배정이 곧 "계속"이다.

### LIMIT that expires as built (ATC-167)

`LIMIT`은 atc가 reset 시각을 모르거나 세션이 이미 마무리했어도 새 지시가 올 때까지 남았다. 이제 늘 끝난다(`server/health.ts`, 순수 함수).

- **마무리는 cut이 아니다.** `wrap_up` 안내 뒤 마지막 assistant 대답이 `stop_reason: "end_turn"`으로 끝나고 세션이 idle이면 health 코드가 없다(cut `LIMIT` 아님). cut은 `end_turn` 없이 멈춘 것이다(도구 결과를 받은 뒤 다음 대답이 없거나, 대답이 아예 없음). 결과 없는 도구 호출은 그대로 `PENDING`이다. 세션이 없는 ABSENT 길(`cutAtOf`)은 ATC-86 규칙 그대로라 RESUME 카드는 바뀌지 않는다.
- **reset 시각을 모르면 5시간 창.** `LIMIT_WINDOW_MS`(5시간)는 atc가 아는 가장 긴 창이다. `resetsAt`이 없는 `LIMIT`(API 오류 `LIMIT`, hook의 `LIMIT` push, ACCOUNT의 FUEL 기록에서 reset을 못 찾은 cut `LIMIT`)은 시작한 지 그만큼 뒤에 풀린 것으로 본다. cut `LIMIT`은 `RESUME`이 되고(`resetsAt` = cut + 5시간, ABSENT AIRCRAFT도 같은 시각이라 기존 RESUME 카드 길을 따른다), 그 밖의 `LIMIT`은 사라진다. FUEL이 아는 진짜 reset이 이기고, reset을 알고 지난 `LIMIT`은 전처럼 `UNANSWERED`다.
- 경보 key 형식과 RESUME 카드는 그대로다.

### NEEDS YOU as built (ATC-99)

백그라운드 세션(세션 파일 `kind: "bg"`와 `jobId`)은 atc가 아는 busy/idle보다 풍부한 기록을 `~/.claude/jobs/<jobId>/state.json`에 둔다. `claude agents --json`의 `state` 칸이 여기서 온다. atc는 이 파일을 읽기만 하고 `Session`에 `job: {state, detail, needs, suggestedReply, since}`를 붙인다. 백그라운드 세션이 아니면 `null`이다.

- **읽기.** `server/job-state.ts`: `parseJob`(순수)은 `state`(`working`·`blocked`·`done`·`stopped`·`failed`, 그 밖의 값은 `null`), `detail`, `needs`·`suggestedReply`(`blocked`일 때만), `updatedAt`만 고른다. `intent`(팀은 CREW BRIEFING 전체)·`output`·`providerEnv`·`linkScanPath`는 읽지도 내보내지도 않는다. `since`는 `timeline.jsonl` 끝(16 KB)에서 지금 state가 이어진 줄들의 첫 줄이고, timeline이 없으면 `updatedAt`이다. `readJob`은 두 파일의 mtime·크기로 job마다 캐시하고, 아무것도 쓰거나 지우거나 잠그지 않는다. ATC-93의 `jobStateOf`(STALE 줄)도 같은 파일의 `state`를 읽는다.
- **화면.** `blocked`인 동안 `NEEDS YOU · <needs>` 칩. 툴팁에 `detail`과 답하는 방법이 있다. FLEET 목록 줄과 카드(카드에는 `suggestedReply`가 복사만 되는 줄로 함께 보이고, atc는 보내지 않는다), STRIPS 스트립(blocked 세션은 PARKED여도 보인다), 관제 세션의 CONTROL 블록 줄에 붙는다. `working`이면 `detail`이 FLEET 목록과 카드에 흐린 한 줄로 보인다.
- **경보.** `health.blockedMin`분(기본 3, `ATC_HEALTH_BLOCKED_MIN`) 넘게 `blocked`이면 `health` 경보 `BLOCKED — <이름>이 N분째 사람을 기다림: <needs>`(키 `health|BLOCKED|<세션>`)가 뜬다. `HealthCode`가 아니라 따로 둔 경보다: `Health`는 DISPATCH를 붙들고 매뉴얼 항목이 있는데 이것은 그렇지 않다. state가 `blocked`를 벗어나면 풀리고 `alert.raised` / `alert.cleared`가 따라온다.
- **이미 끝난 `blocked`(ATC-133).** SUPERVISOR가 답한 뒤에도 job 파일이 `blocked`로 남을 수 있다. `settleJob`(순수, `server/job-state.ts`)은 `tempo`가 `active`이거나, 세션의 마지막 활동(atc가 이미 `lastActiveAt`으로 읽는 대화 기록 mtime, 새 스캔 없음)이 `since`+30초(blocked가 시작될 때 마지막 턴이 함께 기록되므로 두는 GRACE)보다 나중이면 `blocked`가 끝난 것으로 보고 `working`으로 보인다. `detail`(답한 글 그대로이거나 옛 글일 수 있다)·`needs`·`suggestedReply`는 지우고, 파일의 원래 모습은 `settled`에 남겨 `working` 칩 툴팁에 쓴다("job file says blocked since 07:04, working since 07:05"). `blockedAlerts`도 같은 규칙이라 경보가 울리지 않는다. 경보 글은 `needs`이거나 없음이고 `detail`은 쓰지 않는다. 진짜 blocked(뒤 턴 없음, tempo `blocked`·`idle`)는 그대로 보이고 울린다.
- **다시 blocked가 된 job(ATC-138).** `since`는 `timeline.jsonl`에서 `blocked`가 이어진 줄들의 첫 줄이라, 답하고 일하다가 `working` 줄 없이 다시 blocked가 된 job은 옛 `since`를 그대로 갖고, ATC-133의 규칙은 그 뒤 턴을 답으로 읽었다. `settleJob`은 이제 마지막 턴을 `state.json`을 마지막으로 쓴 때(`writtenAt`: `updatedAt`, 없으면 파일 mtime, 그것도 없으면 `since`)와 견준다. 지금 `needs`·`detail`이 적힌 때다. `blocked`가 끝난 것은 `tempo`가 `active`일 때, 또는 마지막 턴이 `writtenAt`+30초 GRACE보다 나중이고 `tempo`가 `blocked`가 아닐 때뿐이다. `tempo: blocked`이고 `needs`가 있으면 뒤에 턴이 이어져도 끝난 것으로 보지 않는다. 경보의 "N분째"는 계속 `since`부터 센다(PILOT'S DISCRETION: `updatedAt`은 새 기다림이 아닌 이유로도 움직여서, 그것으로 세면 진짜 긴 기다림을 가릴 수 있다).
- **확인한 버전** Claude Code 2.1.284(2026-09-29). Claude Code 내부 파일이라 파일이 없거나 다른 버전이거나 모르는 state면 아무것도 보이지 않고 오류도 내지 않는다.

### AIRCRAFT policy hook과 STALE STOP as built (ATC-369)

어떤 AIRCRAFT도 도구 권한 때문에 사람을 기다리지 않고, FLIGHT가 끝난 AIRCRAFT가 슬롯이나 경보를 계속 쥐고 있지 않는다.

- **policy hook.** `hooks/policy.mjs`는 `PermissionRequest` hook이다. Claude Code는 프롬프트가 뜰 호출에만 이 hook을 부르고, hook은 허용이나 거절로 답한다. `launchAircraft`(AIRCRAFT LAUNCH의 단일 길: FLEET LAUNCH, FLEET PLAN, DISPATCH launch 카드, AUTO LAUNCH, FRESH START, REPOSITION)가 `claude --bg`에 `--settings '{"hooks":{"PermissionRequest":[…]}}'`를 더한다(`server/policy-hook.ts`, `server/policy-hook.test.ts`가 확인). `--settings`는 폴더의 설정에 더해지므로 기존 guard와 hook은 그대로 돌고, permission mode·허용 목록·관제 세션은 건드리지 않는다.
- **허용**(AIRCRAFT의 STAND 안: `<repo>/.claude/worktrees/<이름>` 또는 `…/projects/worktrees/<이름>`): STAND나 `~/.claude*/jobs/<id>/tmp` 안의 Edit·Write, 프로젝트 폴더 읽기, 일상 Bash(force·stash·clean·worktree add·main push가 아닌 버전 관리 명령, npm test·run·ci·install, tsc·vite·node, 대상이 STAND 안인 cp·mv·rm·mkdir·sed -i·리다이렉션, localhost `curl`(7700 쓰기는 안 됨), `gh pr create·view·list·checks·diff·comment·ready`와 `gh api` GET·PR 본문 PATCH), 다른 `TEAM_*`가 아닌 곳으로의 SendMessage, EnterWorktree와 권한이 필요 없는 도구, localhost의 Playwright.
- **거절**(기록한다): 나머지 전부. Claude 설정 폴더(`~/.claude*`)와 저장소 메타데이터 폴더 쓰기, STAND 밖이나 STAND에 들어가기 전의 쓰기, `~/.local/state/atc`, `.env*`·ssh 키 읽기, `bash -c`·`eval`·`sudo`·`systemctl`, 읽을 수 없는 명령 치환, MCP 도구(Playwright 제외), WebFetch, 모르는 도구. 거절 메시지는 다시 시도하지 말고 BLOCKED로 보고하라고 알린다.
- **기록.** 거절마다 `<상태 폴더>/policy-denials.jsonl`에 한 줄: 시각, REGISTRATION, 세션, 도구, **class**(`claude-config`, `rm:outside-stand`, `mcp` …). 명령이나 경로의 본문은 저장하지 않는다. fail-closed: 입력을 읽거나 해석하지 못하면 거절한다.
- **샌드박스가 아니다.** STAND 안에서 `node`·`npm`이 아무 코드나 도는 것은 전과 같다. hook은 누구에게 묻는지를 정하지, 코드가 무엇을 할 수 있는지를 정하지 않는다. kill-guard와 다른 hook은 그대로다.
- **화면.** FLEET에 `PENDING <n>`(0이 정상, 아니면 파란색), `DENIED 24h <n>`과 많은 class, `STALE STOP on|off`가 보인다(`GET /api/policy`, 읽기만, `server/policy-run.ts`).
- **STALE STOP.** `server/stale-stop-run.ts`가 1분에 한 번, health가 30분째 `PENDING`·`HUNG`이고 FLIGHT가 끝난 `claude --bg` AIRCRAFT를 멈춘다(`stopAircraft`라 FLIGHT RECORDER에 `by`가 `auto stale-stop (…)`인 `fleet stop` 줄과 `policy stale-stop` 줄이 남는다). 끝났다는 것은: 이 세션이 뜬 뒤의 LOGBOOK 도착(머지나 ARRIVED)이 있고, 아직 쥔 FLIGHT가 모두 도착한 것이다. STOP이 실패하면 10분 쉰다. 규칙은 `server/stale-stop.ts`(순수).
- **스위치.** `dispatch.json`의 `staleStop`, 기본 **on**(live first, shadow 없음). 바꾸는 것은 SUPERVISOR만: 설정 → OPERATIONS → STALE STOP, 앱 Origin이 있는 `PUT /api/settings`(`fromThisApp`). `atcctl` 명령은 없다. 바꾸면 `policy stale-stop-mode` 줄이 남는다.
- **나이가 붙은 job detail.** AIRCRAFT 카드·목록 줄·NEEDS YOU 줄은 백그라운드 job의 `detail`을 지금 하는 일이 아니라 `… · last known, 17 h ago`로 보인다(`server/job-age.ts`). 나이는 `writtenAt`, 없으면 `since`에서 센다.

### ACTIVITY as built (ATC-97)

살아 있는 Claude AIRCRAFT마다 ACTIVITY 한 줄이 붙는다: 마지막으로 부른 도구, 짧은 라벨, 그 도구가 아직 도는지·모델 응답을 기다리는지·쉬는지, 그리고 그게 언제 시작됐는지. 메시지 본문은 담지 않는다.

- **읽기.** `server/activity.ts`(순수 함수). `activityTrackOf(tail)`은 본 대화의 `assistant` `tool_use` 블록과 `user` 줄만 읽는다(서브에이전트·메타·깨진 줄은 건너뛰어, 줄 중간에서 잘린 끝도 괜찮다). `tool_use`는 그 `tool_result`가 올 때까지 도는 중이고, 새 지시(또는 중단)가 오면 앞 턴의 도구는 끝난 것으로 본다. `activityFromTrack(track, status)`가 phase를 얹는다: 세션이 idle이면 `idle`, 결과 없는 호출이 있으면 `tool`(가장 늦은 것을 보여서 병렬 호출도 맞다), 아니면 `model`. `at`은 `tool`이면 도구 호출, `model`이면 마지막 결과·지시, `idle`이면 마지막 기록 시각이다.
- **라벨.** `Bash`·`Agent`·`Task`는 `description`, `Read`·`Edit`·`Write`는 파일 이름, `mcp__<server>__<tool>`은 `<server> <tool>`, `Skill`은 skill 이름, `SendMessage`는 받는 쪽. 그 밖의 도구는 라벨이 없다. 제어 문자와 방향 문자를 빼고 60자로 자른다. Bash `command`, 파일 내용, 프롬프트, 도구 결과, thinking, assistant 글은 결과에 들어가지 않는다(`server/activity.test.ts`가 확인한다).
- **두 번 읽지 않는다.** `healthOfSession`이 같은 64KB 끝에서 추적 값을 셈해 같은 캐시(크기·mtime 키)에 두고, 이제 `{ health, activity }`를 돌려준다. 스냅샷은 살아 있는 Claude 세션에만 `Session.activity`를 싣고, `fleet-live.ts`가 이를 `AircraftView`와 FLEET 목록 줄로 옮겨 FLEET와 STRIPS가 스냅샷 속도로 바뀐다. FLIGHT RECORDER의 `sample`·`event` 줄에는 들어가지 않는다.
- **화면.** `Bash · Run the test suite · 12s` 같은 흐린 한 줄(`idle · …`은 더 흐리게, 모델을 기다리면 `model · …`·`thinking · …`, phase 색 점)이 STRIPS 스트립의 callsign 아래, FLEET 목록 FLYING 칸의 둘째 줄, FLEET 카드의 FLYING 아래에 붙는다. phase 표시가 앞에 오고 경과 시간은 늘 보이며, 칸이 좁으면 라벨이 잘린다.

### ACCOUNT 줄(ATC-146)

- **관찰한 ACCOUNT.** FLEET 줄에는 `account`(프로필의 home ACCOUNT)와 `observedAccount`가 있다. `observedAccount`는 살아 있는 세션이 home과 다른 ACCOUNT의 폴더에서 돌 때만 채워진다([accounts.md](accounts.md) 5.1). 이때 목록 줄의 칩과 카드의 ACCOUNT 줄은 `acct-1 (home acct-2)`로 보인다. 오류가 아니고 경보도 없다. LIMIT 붙들림(8.8)과 FUEL([fuel.md](fuel.md) 6.2)은 그 AIRCRAFT를 관찰한 ACCOUNT로 센다.
- **설정 창.** ACCOUNTS 분류가 라벨 → 폴더, `loggedIn`, `authMethod`, statusline·hook 경고를 보인다(ATC-189부터 메뉴의 한 분류, 전에는 AGENTS 탭의 블록). SUPERVISOR만 고친다.
- **스냅샷.** `Session.account`가 더해진다. `~/.claude`만 있으면 없다.

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
9. ✅ 세션 조종(8.5): FLEET 탭의 LAUNCH·STOP. 남은 일: 자동 STOP(FLEET PLAN 4단계. 그림자·승인 운용은 8.6·8.7에서 만듦), FLEET PLAN 밖의 RESTART, 다시 띄우는 CREW CHANGE, 사용량 예산
10. ✅ AIRCRAFT health(8.8, ATC-45·47·48·51·55·86): 대응 매뉴얼과 pull 분류기, push hook. snapshot, FLEET 줄, FLIGHT FOLLOWING, TOWER 브리핑, DISPATCH·SCHEDULE 거르기, health에서 나오는 FLEET PLAN 제안, ACCOUNT로 묶고 붙드는 `LIMIT`, ACCOUNT별 FUEL REMAINING, 이벤트로 읽는 한도 끊김 `LIMIT`·`RESUME`·`STALLED`

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
