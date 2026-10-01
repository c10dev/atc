# 자율 운영: PR마다 머지하던 SUPERVISOR를 길에서 빼기

[English](autonomy.md) · **한국어**

상태(2026-10-01): [ATC-333](https://linear.app/vocado/issue/ATC-333)의 설계 초안. SUPERVISOR는 2026-10-01에 자신은 방향(ROUTE, 우선순위, 무엇을 만들지)을 정하고 PR은 읽지 않기로 했고, 사람 게이트를 정확히 셋만 두기로 했다(2절). 이 문서의 어느 것도 만들어지지 않았다. 이미 있는 것은 "현재 사실"에 적었다. 아래 어떤 행에도 완료 표시를 하지 않았다. 머지 뒤 DUTY나 ENGINEERING이 상태를 고친다.

관련: [occ.ko.md](occ.ko.md) 9.7(AUTOLAND), [mcc.md](mcc.md)(MCC, 등급, SHIP / SHOW / ASK), [research/code-review.ko.md](research/code-review.ko.md)(ATC-332 조사, 여기 숫자 대부분의 출처), [watch.md](watch.md)(보류), [duty.md](duty.md)(L0–L4), [fleet.ko.md](fleet.ko.md), [dispatch.ko.md](dispatch.ko.md), [atfm.ko.md](atfm.ko.md).

## 1. 현재 사실

2026-10-01 ~17:30Z에 `origin/main`과 읽기 전용 로그에서 다시 읽었다. 개수만 적었고 다른 AIRPORT는 일반적으로 서술한다. 표시: *[observed]*는 atc 로그나 GitHub에서 읽은 것, *[replay]*는 머지된 PR에 atc 규칙을 다시 돌린 것, *[assumed]*는 내 추론. 바깥 증거는 조사 문서([research/code-review.ko.md](research/code-review.ko.md))에 있다.

### 1.1 머지 길

- **AIRPORT A(AUTOLAND AIRPORT).** 2026-10-01까지 7일간 PR 121건 머지, 머지 없이 닫힌 것 0건, 약 117건은 손으로, 4건은 AUTOLAND가 머지. 열고 나서 머지까지 중앙값 150분, p90 45시간 [observed, 조사 2.2–2.3]. 2026-10-01에 SUPERVISOR가 `reviewedSecurity`를 `delegate`로 바꾸고(16:25Z) "Require branches to be up to date"를 끄고 `applicationCheck`를 빌드 체크로 바꿨다. 그 전에는 하루 약 40건을 손으로, 1건을 AUTOLAND가 머지했다. 보안 게이트의 규칙 하나는 머지된 PR의 79%에 걸린다(키워드만 42%) [replay]. 아직 SUPERVISOR에게 남는 CLEARED PR은 `Risk: Contract` 라벨(2건)과 머지 리뷰가 아직 없는 보안 키워드(1건)가 붙잡는다 [observed, ATC-333 본문].
- **ATCC(atc 자신).** MCC가 `land+rts` 모드에서 `auto`·`flagged` PR을 착륙시킨다: 7일에 134건, 열고 나서 머지까지 중앙값 5분. INSPECTION의 findings는 head의 8%. ESCALATE 28줄(PR 27건)이 SUPERVISOR에게 갔다(`user` 등급과 state 형식 변경) [observed].
- **다른 AIRPORT.** lander가 없는 곳이 있다: SUPERVISOR나 위임된 세션이 손으로 머지한다([mcc.md](mcc.md), [occ.ko.md](occ.ko.md). 개수는 여기서 다시 재지 않았다).
- **조사 뒤 머지된 것:** migration 게이트(ATC-329: 새 버전이 모두 호스팅 DB에 적용돼 있으면 migration PR을 위임할 수 있다), 워크플로 이름도 맞는 GROUND STOP과 이름이 아무것에도 안 맞을 때의 경고(ATC-330), SUPERVISOR에게 남은 CLEARED PR의 유예 시간(ATC-331).

### 1.2 오늘의 안전망

- **머지 전:** CI, 리뷰 레인 넷(Codex, REVIEW, MCC INSPECTION, AUTOLAND 머지 리뷰, 각각 정확한 head에 묶임), 결정적 제외 규칙, 빨간 `main`에서 AUTOLAND를 멈추는 GROUND STOP.
- **atc의 머지 뒤:** health check가 있는 RTS와 ROLLBACK.
- **없는 것**(이 문서가 요구하는 것): `main`을 빨갛게 만든 PR의 자동 revert, AIRPORT의 배포 뒤 검사와 rollback, 첫째와 독립인 둘째 리뷰어, 키워드 대신 diff를 읽는 분류기, 주간 빠져나간 결함 보고, 게이트를 스스로 조이는 breaker, GROUND STOP이 시험 실패를 보도록 AIRPORT의 `main`이 push마다 돌리는 lint와 시험.
- **빠져나가는 결함의 기준선**(조사): 7일간 AIRPORT A `main` head 118개 중 2개가 빨강(1.7%), revert나 hotfix PR 없음, 머지 없이 닫힌 PR 없음. 작은 숫자이며 지켜볼 기준선이지 게이트가 아무것도 못 잡는다는 증거가 아니다.

### 1.3 기록에 남는 다른 사람의 결정

로그가 시작된 2026-09-26부터의 개수(약 5.5일) [observed]:

- DISPATCH: ASSIGN 제안 414건, 승인 315건(클릭 285, CROSSCHECK 일치 30), 기각 7건. CROSSCHECK 판정은 agree 73, disagree 17. LAUNCH 승인 89건은 전부 SUPERVISOR.
- FLEET PLAN: 승인 5건(LAUNCH나 REFRESH), 만료 15건. SCHEDULE: 초안 28건, CROSSCHECK 판정 26건.
- Clearance: 513건 발행(INFO 326, GO AROUND 90, LAND 68, FIX 23). 세션 사이에서 오가며 사람이 필요 없다.
- RTS: 8건 거절(`package*.json`이나 systemd 유닛 4, CI가 준비되지 않았거나 없음 4), 146건 실행. HUMAN CHECK: 1건.

### 1.4 SUPERVISOR 전용 규칙에서 인벤토리가 찾은 것

SUPERVISOR만 부를 수 있는 라우트는 localhost `Origin`을 검사하고(`fromThisApp`), `atcctl`에는 그 명령이 없다. 라우트를 읽어 보니 그 검사가 없는 것이 있다: LAUNCH가 아닌 DISPATCH 카드의 승인·기각, DISPATCH와 SCHEDULE 모드 전환, SCHEDULE 승인·기각, ATFM 라우트(`proposals.ts`, `schedule.ts`, `atfm-run.ts`. [watch.md](watch.md)와 [fleet.ko.md](fleet.ko.md)에도 적혀 있다). 이것들이 SUPERVISOR 전용인 까닭은 서버가 거절해서가 아니라 어떤 관제 세션에도 그 명령이 없고 guard가 `curl`을 막기 때문이다. 자율 규칙(K3)은 `7700`에 닿는 다른 길을 찾아낸 세션에도 버텨야 하므로 이것이 중요하다. 보강은 통제 C12이고 10절에 결정이 있다.

## 2. 남는 세 게이트

2026-10-01에 SUPERVISOR가 정한 그대로다. 이 문서는 그것을 바꾸지 않는다. 분석이 바꾸라고 말하는 곳은 10절의 질문이다. DUTY 카드 버튼 G2(MERGE)·G3(상태 이동)([duty.md](duty.md))과 헷갈리지 않도록 K1–K3("kept")이라 부른다.

1. **K1: 호스팅 DB에 migration을 적용하거나 라이브 데이터를 바꾸는 것.** 머지는 되돌릴 수 있지만 잃어버린 데이터는 못 되돌린다.
2. **K2: 비밀과 키(`.env`, 자격 증명), 결제나 법적 문구, 콘텐츠 권리(`Risk: Rights`).** 코드 품질이 아니라 바깥에 대한 책임이다.
3. **K3: atc 자신의 guard, 권한, `.claude/` 설정, 자율 규칙 자체**(세션이 무엇을 할 수 있는지 정하는 파일. AUTOLAND, MCC, LANDING 등급 규칙 포함). 에이전트는 자기 한계를 넓히는 것을 스스로 승인하지 않는다.

## 3. 원칙

1. **SUPERVISOR는 방향을 정한다.** 시간은 ROUTE, 우선순위, 주간 품질 보고, 세 가지 승인에 쓰고 PR을 읽는 데 쓰지 않는다.
2. **통제가 먼저 서고 게이트가 나간다.** 게이트도 통제도 없는 틈을 두는 단계는 없다. 게이트는 그 통제가 shadow로 돌았고 정해 둔 측정이 가도 좋다고 말한 뒤에만 없앤다.
3. **조이는 것은 빨리, 푸는 것은 천천히.** 시스템은 규칙을 스스로 조일 수 있다(breaker, 통제 C6). 푸는 것은 SUPERVISOR가 한다. K3이 여기서 나온다: 시스템이 돌리는 어느 것도 자기 확대를 승인할 수 없다.
4. **되돌릴 수 없는 것은 사람, 되돌릴 수 있는 것은 revert.** K1과 K2가 되돌릴 수 없는 것이다. 나머지는 놓친 결함에 대한 답이 먼저 읽는 사람이 아니라 빨리 착륙하는 revert다.
5. **반복이 아니라 독립.** 리뷰 둘은 오류가 다를 때만 도움이 된다: 다른 벤더나 모델, 다른 지시, 서로 보지 않음. 바깥 증거는 오류가 겹친다고 말한다(같은 오답 60%, 조사 1.2). 그래서 지켜볼 숫자는 일치율이고, 표본은 셋째 리뷰어가 감사한다.
6. **PR 글은 믿을 수 없는 사람이 쓴 입력이다.** 분류기와 리뷰어는 diff를 읽는다. PR 본문과 라벨은 위험을 올릴 수 있는 힌트일 뿐 낮추지 못한다.
7. **모두 head에 묶이고 기록되고 센다.** 자동 판정은 모두 자기가 판단한 head를 적고 저장되며 주간 보고에 나온다.
8. **shadow로 먼저, 그다음 전환.** 새 통제는 옛 게이트 옆에서 돌며 자기가 했을 일을 적는다. 전환을 정하는 측정은 돌리기 전에 적어 둔다.
9. **brake는 게이트가 아니다.** SUPERVISOR는 HOLD, 수동 GROUND STOP, CANCEL, RECALL, 모드 전환을 brake로 가진다. 아무것도 이것을 기다리지 않으니 남는다.
10. **방향은 게이트가 아니다.** ROUTE와 우선순위를 고르는 것, 이슈를 Backlog에서 Todo로 옮기는 것, 아이디어에 라벨을 다는 것, DUTY 헌장은 무엇을 만들지 말하는 입력이다. PR 길의 어느 것도 이것을 기다리지 않는다.

## 4. 게이트 인벤토리

atc가 사람의 결정을 요구하거나 제안하는 모든 곳을 영역별로 묶었다(sub-agent가 문서와 라우트를 읽었고, 착륙 규칙은 `server/landing.ts`·`server/autoland.ts`와, 개수는 로그와 대조했다). "7일"은 로그가 있는 곳의 개수이고 "not logged"는 그 게이트의 기록이 없다는 뜻이다. 판정: **keep**(K1, K2, K3만), **automate**(게이트가 기계 판단이 되고 통제를 적는다), **remove**(통제가 돌면 게이트가 사라진다), **brake**나 **direction**(게이트가 아님, 원칙 9와 10). 통제 칸은 5절의 통제 하나를 가리키며, 판정이 효력을 내기 전에 먼저 선다(순서는 8절).

### 4.1 착륙과 머지

| ID | 게이트 · 위치 | 막는 것 | 7일 | 판정 | 먼저 서는 통제 |
|---|---|---|---|---|---|
| L1 | `Risk: Contract`와 `Risk: Security` 라벨, 티켓이나 PR(`mergeExclusionOf`, `externalGateOf`. `autoland.ts`, `landing.ts`) | 계약·보안 변경이 리뷰 하나로 머지됨 | 오늘 CLEARED PR 2건이 붙잡힘. replay에서는 머지 121건에 PR 라벨 0건(티켓 라벨은 오프라인에서 못 읽음) | **automate** | C1 이중 리뷰, C2 분류기, C4 자동 revert, C6 breaker, C7 감사 |
| L2 | `rating:SEC` 티켓 라벨(같은 함수) | SEC 작업이 더 조심하지 않고 머지됨 | not logged | **automate** | C1, C2, C4, C6, C7 |
| L3 | 보안 경로: auth, session, RLS와 policy, admission, functions, middleware(`securityPathOf`) | 접근 통제 변경이 눈에 안 띄고 머지됨 | replay: 머지 121건 중 44건(36%) | **automate**: 경로는 C2의 입력이 된다. 비밀 경로와 migration 경로는 L5, L6을 따른다 | C1, C2, C4, C6, C7 |
| L4 | PR·FLIGHT 글의 보안 키워드(`securityWordOf`, `SECURITY_WORDS`) | 말로 적힌 보안 변경 | replay: 121건 중 94건(78%), 키워드만 51건(42%) | **remove**, 키워드가 잡은 PR 중 사람이 원했을 것을 C2 shadow가 모두 표시한 뒤 | C2 diff 분류기(두 주 shadow), C1 |
| L5 | migration과 SQL 경로(`migrationPathOf`, `hostedDb` migration 게이트 ATC-329) | migration이 호스팅 DB에 적용되기 전에 머지됨 | replay: 121건 중 19건(16%) | **keep**(K1), 한 번 클릭 승인으로. 새 버전이 모두 적용돼 있으면 이미 자동. 기존 migration을 고치거나 지우거나 이름을 바꾸면 K1 승인으로 남는다 | C9 한 번 클릭 승인 |
| L6 | 비밀과 키 경로(`secretPathOf`: `.env*`, 자격 증명, 키, 인증서) | 자격 증명이 저장소에 들어옴 | replay: 121건 중 0건 | **keep**(K2), 한 번 클릭 승인으로 | C9 |
| L7 | `Risk: Rights` 라벨, 결제나 법적 문구 | 바깥에 대한 책임(K2) | not logged | **keep**(K2) | C9 |
| L8 | PR에 FLIGHT 없음(`gate.hard`) | 아무도 시키지 않은 변경, 추적 불가 | not logged | **automate** | C15 FLIGHT 연결(DUTY나 DISPATCH가 FLIGHT를 잇거나 연다. 없으면 SUPERVISOR가 아니라 DUTY에게 간다) |
| L9 | 파일 100개 이상이거나 파일 목록을 못 읽음(`mergeExclusionOf` 5단계) | 판단하기엔 너무 큰 diff | not logged | **automate** | C1의 full 등급(리뷰어를 더, diff 전체 패킷), C7. 조사 W7의 크기 힌트 |
| L10 | HUMAN CHECK 종류 CHOICE, ACCOUNT, DEVICE(`human-check.ts`, `/api/human-check`) | 사람이 판단해야 하는 UI 변경 | 1건 | **automate**: CHOICE는 flag나 preview 뒤로, DEVICE는 기기 smoke 실행으로, ACCOUNT는 K1·K2에 닿지 않는 한 | C10 검증 레인과 증거 패킷, C4, C6 |
| L11 | MCC ESCALATE(`mcc-run.ts`, `docs/mcc.md`): 모델이 PR을 `user`로 올림 | 의심, state 형식 변경, 되돌리기 어려운 변경 | 28줄(PR 27건) | 더하기만 하는 state 형식 변경과 되돌릴 수 있는 변경은 **automate**, PR이 K3에 닿으면(L12) **keep** | C13 형식 호환 검사, C1, C4 |
| L12 | guard, hooks, `.claude/`, 루트 `CLAUDE.md`, `rulebook/`, `*guard*.mjs`, `deploy/landing-tier.mjs`의 `user` 등급(`landing-tier.mjs`) | 세션이 자기 한계를 넓힘 | 위 28건에 포함 | **keep**(K3) | C9, C12 |
| L13 | `.github/`, `package*.json`, `deploy/` 유닛의 `user` 등급 | CI·의존성·서비스 유닛 변경이 눈에 안 띄고 착륙 | 위 28건에 포함 | `.github/`와 `deploy/` 유닛은 **keep**(K3), `package*.json`은 **automate**. K3의 끝은 질문 D6(a–c) | 남는 부분은 C12, `package*.json`은 C16 의존성 리뷰 |
| L14 | MERGE 클릭(DUTY G2): SUPERVISOR가 `user` 등급 PR을 머지(`pr-merge-run.ts`, `mergeVerdictOf`) | 틀렸거나 낡은 head를 머지 | 따로 기록 안 됨 | K3 PR은 **keep**(한 번 클릭 승인, C9), 나머지는 L11·L13이 좁혀지면 **remove** | C9 |
| L15 | GROUND STOP 해제: SUPERVISOR가 걸린 stop을 푼다(`autoland-run.ts`, ATC-330) | 깨진 `main`에 머지 | 걸린 적 0건 | **automate**: revert 뒤 초록 head가 풀어 준다 | C3 main 시험, C4 자동 revert, C6 |
| L16 | 리뷰 레인 가용성: Codex 한도나 제외로 PR이 리뷰 없이 남음(`landing.ts`) | 리뷰 없는 PR | 재리뷰 요청 13건 중 11건이 REVIEW로 | **automate**(이미 대체 레인) | C1이 둘째 레인을 준다. 지출 상한 C11 |
| L17 | stacked PR과 STRANDED 경보를 SUPERVISOR가 손으로 고침(`docs/occ.md`) | `main`에 닿지 못한 머지 | not logged | **automate** | C4: revert·착륙 레인이 stacked PR의 base가 머지되면 retarget·rebase도 한다 |
| L18 | STAND 보유자가 없는 GO AROUND·FIX의 손 RELAY(`supervisor-queue.ts`) | 갈 곳 없는 알림 | relay 14줄 | **automate** | C15: DUTY가 맡아 FLIGHT를 열거나 다시 연다. 드문 경우 |
| L19 | 모드 전환: AUTOLAND `off/update/merge`, `reviewedSecurity`, MCC 모드, `teamsMerge`, `hostedDb`, `externalReview.security`(설정 창) | 동의 없이 머지를 위임함 | 전환 1건(delegate) | **keep**(K3): 자율이 얼마나 있는지는 SUPERVISOR가 고르고 breaker(C6)는 조이기만 한다 | C6 |
| L20 | PR의 HOLD(AUTOLAND와 MCC), CANCEL, RECALL | 잘못된 것을 멈춤 | HOLD 2줄 | **brake** | 필요 없음 |

### 4.2 배포

| ID | 게이트 · 위치 | 막는 것 | 7일 | 판정 | 통제 |
|---|---|---|---|---|---|
| D1 | RTS를 시작하는 UPDATE bar 클릭(`update-run.ts`) | 배포 시점 | `land+rts`에서 배포는 대부분 자동. 클릭은 따로 안 센다 | **remove**(기다리는 것이 없다) | RTS health check와 ROLLBACK, 이미 있음 |
| D2 | `package*.json` 의존성 변경에 대한 RTS 거절(`deploy/rts.mjs`) | 사람 없이 `npm ci` | 4건 거절(유닛 포함) | **automate** | C16 필수 체크인 의존성 리뷰, 그다음 health check와 ROLLBACK이 있는 RTS 안의 `npm ci` |
| D3 | `deploy/*.service` 유닛에 대한 RTS 거절(`daemon-reload`) | 서비스 유닛이 무엇이 어떤 권한으로 도는지 바꿈 | 위에 포함 | **keep**(K3: 서비스가 할 수 있는 일을 정한다) | C9 |
| D4 | ROLLBACK 뒤 SUPERVISOR가 MCC 모드를 다시 고를 때까지 RTS가 꺼진 채(`docs/mcc.md`) | rollback 반복 | rollback 0건 | **keep**(K3, 배포의 breaker이고 푸는 것은 SUPERVISOR) | C6 |
| D5 | 배포로 죽은 세션을 손으로 다시 띄움 | 잃은 작업 | 0건 | **automate** | C16: health check가 찾은 죽은 세션을 다시 띄움(CONTROL RECYCLE 방식). 3조건 검사가 이미 알아본다 |
| D6 | AIRPORT 배포: 배포 뒤 검사가 없다 | AIRPORT의 나쁜 배포 | 해당 없음 | **통제 없음** | C5 호스트가 지원하는 곳의 배포 뒤 검사와 rollback |

### 4.3 DISPATCH, FLEET, SCHEDULE

| ID | 게이트 · 위치 | 막는 것 | 개수 | 판정 | 먼저 서는 통제 |
|---|---|---|---|---|---|
| P1 | ASSIGN, RELEASE, CLASSIFY 승인·기각(`proposals.ts`, [dispatch.ko.md](dispatch.ko.md)) | 틀린 AIRCRAFT-FLIGHT 짝 | 승인 315건(클릭 285), 기각 7건 | **automate** | C14 CROSSCHECK 일치와 이미 있는 blind 표본, C11 상한 |
| P2 | LAUNCH 카드 승인(`proposals.ts`, Origin) | 사용량을 쓰는 세션 시작 | 89건, 전부 SUPERVISOR | **automate** | C11 지출 상한(FUEL hold, `ATC_MAX_LAUNCHED`), C14 |
| P3 | FLEET PLAN 승인과 판정(`fleet-plan-run.ts`) | 사용량 지출, 낡은 제안 | 승인 5건, 만료 15건 | **automate**: 되돌릴 수 있는 종류(놀고 있는 세션의 STOP)부터, 그다음 상한 아래의 LAUNCH | C14, C11 |
| P4 | CREW CHANGE 승인과 "전달함"(`crew-change.ts`) | 동의 없이 돌고 있는 팀의 CREW를 바꿈 | not logged | **automate** | C14 |
| P5 | SCHEDULE 작업 승인·기각·판정(CLASSIFY, NEW, CLOSE, TAIL, WAYPOINT. `schedule.ts`) | 틀린 티켓 수정 | 초안 28건, CROSSCHECK agree 30, disagree 9 | **automate** | C14 |
| P6 | 전달 안 된 FLIGHT PLAN과 CLEARANCE의 손 전달 | 전달하지 못한 메시지 | undelivered 10줄 | **automate** | C14: 전달 재시도와, 그래도 안 되면 DUTY 알림 |
| P7 | NEEDS YOU: 도구 승인 프롬프트에서 막힌 세션 | 권한 결정을 기다리는 세션 | 경보라서 여기서 세지 않음 | 프롬프트는 **keep**(K3: 권한), 방향에 대한 막힌 질문은 **direction** 입력 | C9 |
| P8 | SUPERVISOR CONFIRM AT AIRCRAFT(`user` 등급 FLIGHT의 go) | go 없이 진행하는 `user` 등급 FLIGHT | 1줄 | **keep**(K3) | C9 |
| P9 | DISPATCH, SCHEDULE, FLEET PLAN, ATFM, CONTROL RECYCLE, FUEL hold, REPOSITION, JEV, SQUELCH 모드 전환 | 측정 전에 자동화를 켬 | judges 모드 1줄 | **keep**(K3) | C6 |
| P10 | ATFM 스위치와 `s3` | shadow 한 주 전의 자동 동작 | 세지 않음 | **keep**(K3) | C6 |
| P11 | ATFM 수동 GROUND STOP, GROUND DELAY | 손으로 출발을 멈춤 | not logged | **brake** | 없음 |
| P12 | ADD ACCOUNT, LOGIN, SHARE MEMORY(`accounts-run.ts`) | 자격 증명 | not logged | **keep**(K2) | C9 |
| P13 | CHECKRIDE rating 부여(SEC rating이 SEC 작업을 맡을 수 있는 팀을 정한다) | 추천만으로 팀이 권한을 얻음 | not logged | 부여는 **keep**(K3), 회수는 조이는 것. 질문 D6(d) | C9 |
| P14 | workspace trust 프롬프트, 저장소마다 한 번 | 믿지 않는 폴더의 세션 | 세지 않음 | **keep**(K3) | 없음 |
| P15 | AIRCRAFT의 LAUNCH, STOP, AOG, RETIRE, ENTRY를 손으로 | 플릿의 모양과 사용량 | 위 FLEET PLAN 개수 | **direction**(플릿 설계) | 없음 |

### 4.4 방향, DUTY, guard

| ID | 게이트 · 위치 | 막는 것 | 개수 | 판정 | 통제 |
|---|---|---|---|---|---|
| X1 | FLIGHT 상태 이동 Backlog, Todo, Canceled(DUTY G3 버튼, `flight-state-run.ts`) | 잘못된 Linear 전이 | not logged | **direction** | 없음 |
| X2 | IDEAS: GitHub의 `idea` 이슈에 라벨 달기 | 검토 안 된 일 | not logged | **direction** | 없음 |
| X3 | DUTY 헌장 확정, 상시 결정, retire, dismiss(`duty-api.ts`) | DUTY가 틀린 브리프로 움직임 | 7일에 초안 1건 | **direction** | 없음 |
| X4 | DUTY L1 스위치 `duty.json` `l1`. DUTY는 L2–L4를 받지 않는다 | DUTY가 권한을 얻음 | 0건 | **keep**(K3) | C12 |
| X5 | guard: `controller/guard.mjs` 프로필, `occ/*guard*`, `duty/guard.mjs`, `mcc/*guard*`, `crosscheck/read-guard.mjs`, `hooks/` | 한 역할이 다른 역할의 명령을 돌림 | 막은 줄 세지 않음 | **keep**(K3) | C12 |
| X6 | `.claude/`와 루트 `CLAUDE.md` 변경 | 권한·지시 변경 | 위 ESCALATE 28줄에 포함 | **keep**(K3) | C9 |
| X7 | `landing-tier`의 `SIDE_EFFECT` 시험 스캔 | 명령을 돌리는 새 서버 파일이 `auto`로 착륙 | 분류될 때까지 CI가 실패 | **keep**(K3) | C12 |
| X8 | WATCH(설계만, 만들어진 것 없음) | 밤 동안 자율의 범위 | 해당 없음 | **아직 게이트 아님**. 만들면 WATCH의 OPS SPEC은 5절과 8절로 들어온다 | C6 |

게이트가 아니라서 뺀 것: 세션 사이의 clearance, MCC INSPECTION `findings`(작성자가 고치고 클릭 없음), MCC 착륙 조건 L1–L8과 리뷰 레인 자체(기계), HOLD(brake).

## 5. 보완 통제

통제마다 무엇을 알아채는지, 얼마나 빠른지, 스스로 무엇을 하는지, 무엇을 보고하는지 적는다. 사람의 결정을 대신하는 통제는 C1, C2, C4, C6, C10, C14, C15, C16이고 나머지는 이들을 받친다.

| ID | 통제 | 알아채는 것 | 속도 | 스스로 하는 일 | 보고 |
|---|---|---|---|---|---|
| C1 | **이중 독립 리뷰.** 같은 head의 리뷰 둘이 모두 통과해야 하며 사람 대신이다(전에 보안·위험 게이트가 붙던 PR). 둘째 레인은 PR 작성 세션과도 첫째 레인과도 다른 벤더이고, 자기 지시가 있으며 첫째의 판정을 보지 않는다(원칙 5, 6). 불일치나 P0·P1 지적은 머지를 막고 셋째 리뷰로, 그다음 SUPERVISOR가 아니라 DUTY에게 간다. | 리뷰어 하나가 놓칠 결함. 오늘은 두 레인이 같이 본 head가 없다(조사 2.4) | head마다 몇 분, 둘째 레인은 병렬 | 막고, 셋째 리뷰어에게 묻고, 두 판정을 기록 | 주간 일치율과 불일치 |
| C2 | **diff 위험 분류기.** 리뷰어가 diff를 보고 변경이 보안·계약 경계에 닿는지 판단해 `securityBoundary`와 이유를 쓴다. 키워드 규칙은 shadow 뒤에만 뺀다. 결정적 바닥은 남는다: 비밀 경로, migration 경로, K3 경로. PR 글은 위험을 올릴 수만 있고 내리지 못한다. | 키워드 없는 경계 변경, 아무것도 안 건드리는 PR의 키워드 | 리뷰 안에서 | PR을 C1의 full 등급으로 올림. 내리지는 않음 | 분류기 대 키워드·경로 결과, 둘 다 놓친 경우 |
| C3 | **`main`이 push마다 lint와 시험을 돌린다**(AIRPORT 자체 CI. ATC-333에 이어진 VOC 이슈로 추적). GROUND STOP과 revert 레인이 빌드 실패만이 아니라 시험 실패도 보게 한다. | 빌드는 되지만 시험이 실패하는 머지 | push 때 | head의 체크를 실패시킴 | 빨간 head 수 |
| C4 | **자동 revert.** 머지가 `main`을 빨갛게 만들면 lander가 그 머지의 revert PR을 열고, 같은 레인으로 리뷰하고 CI가 초록이면 착륙시키고, 다음 초록 head에서 GROUND STOP을 풀고 DUTY에게 알린다. 안전장치: 한 번에 revert 하나, revert의 revert는 안 함, 한 시간에 revert 둘이면 또 revert하는 대신 breaker(C6)가 조인다(revert 폭풍). | 작성자가 빨리 안 고치는 빨간 `main` | 빨간 head 몇 분 뒤 | 열고, 착륙시키고, 풀기 | 착륙한 revert, 초록까지 시간, 폭풍 |
| C5 | **호스트가 이전 빌드를 승격할 수 있는 AIRPORT의 배포 뒤 검사와 rollback**: 배포 뒤 smoke 요청과 오류율 읽기, 실패하면 rollback. | CI는 통과하고 운영에서 실패하는 배포 | 배포 몇 분 뒤 | rollback하고 GROUND STOP을 건다 | 주간 실패 배포 |
| C6 | **breaker.** 굴러가는 창에서 빨간 head, revert, 감사 지적, 불일치를 센다. 문턱을 넘으면 단계로 스스로 조인다: 키워드·경로 게이트 복원, 그다음 AUTOLAND를 `merge`에서 `update`로, 그다음 GROUND STOP. 절대 풀지 않는다: 보고를 읽은 SUPERVISOR가 다시 푼다. | 오르는 결함률 | 주기마다(90초) | 모드를 내리고 알림 하나 | breaker 상태와 모든 사건 |
| C7 | **감사 표본.** 두 레인과 다른 셋째 리뷰어가 자동 머지된 head의 약 10%를 머지 뒤 다시 리뷰한다. P0·P1 지적은 breaker에 센다. | C1의 공동 사각지대 | 한 시간 안 | 기록을 쓴다. PR 댓글은 없다 | 감사한 head와 지적 |
| C8 | **주간 보고**(7절). | 흐름의 이탈 | 주간 | 보고를 만든다 | 보고 |
| C9 | **K1, K2, K3의 한 번 클릭 승인**(6절): head에 묶인 증거 패킷, SUPERVISOR는 클릭한다. | 낡은 head나 다른 head 승인 | 클릭 때 | 서버가 다시 확인한 뒤 그 head로 머지 | 승인과 기다린 시간 |
| C10 | **검증 레인.** 세션이 변경을 돌려(시험, smoke 흐름, preview) 증거를 붙인다. HUMAN CHECK 종류를 대신한다. | 실행 때만 보이는 실패 | 몇 분 | 증거를 붙이고 실패하면 막음 | PR마다 증거 |
| C11 | **지출 상한**: 추가 리뷰와 자동 LAUNCH에 대한 FUEL hold, `ATC_MAX_LAUNCHED`, 하루 리뷰 예산. | 비용 폭주 | 결정마다 | 멈춘다 | 머지당 비용 |
| C12 | **K3 보강.** SUPERVISOR 전용 라우트는 모두 localhost `Origin`을 검사하고(1.4의 라우트), AUTOLAND·MCC·RTS는 리뷰가 어떻든 K3 경로를 건드리는 PR을 거절한다. 규칙 파일은 `deploy/` 아래에 두고 그 파일 자체도 `user` 등급이다. | SUPERVISOR 전용 동작에 닿거나 자기 한계를 고치는 에이전트 | 요청 때 | 거절 | 거절 수 |
| C13 | **state 형식 호환 검사.** CI 시험이 이전 state 파일을 새 코드로 읽고, 더하기만 하는 선택 필드만 허용한다. | 기존 state를 고아로 만드는 형식 변경 | CI에서 | PR을 실패시킴 | 시험 결과 |
| C14 | **일치 기반 제안 승인.** DISPATCH, CREW CHANGE, SCHEDULE, FLEET PLAN 항목은 CROSSCHECK가 일치하면 승인한다. 이미 있는 5건 중 1건 blind 표본은 SUPERVISOR가 읽도록 남기고, C11의 상한을 둔다. | 틀린 짝이나 쓰기 | 제안 때 | 승인하고, 불일치면 보류 | 자동 대 수동 일치 |
| C15 | **FLIGHT 연결.** FLIGHT 없는 PR은 브랜치 이름으로 이슈에 잇거나 하나를 연다. 못 만들면 DUTY에게 간다. | 추적 불가한 일 | PR을 열 때 | 잇거나 연다 | 연결 안 된 PR |
| C16 | **배포 보강.** 필수 체크로서의 의존성 리뷰, 재시작 전 RTS 안의 `npm ci`(이미 있는 health check와 ROLLBACK과 함께), health check가 찾은 죽은 백그라운드 세션 재기동. | 서비스를 깨는 의존성 변경, 배포로 잃은 세션 | 배포 때 | 설치, 검사, rollback, 재기동 | rollback이나 재기동이 필요했던 배포 |

## 6. 남는 세 게이트를 한 번 클릭 승인으로

이상적으로는 승인마다 PR을 읽는 대신 버튼 하나다. 한 화면이 셋을 맡는다: 기존 SUPERVISOR QUEUE 행(`LANDING`)과 PR drawer, 그리고 ANNUNCIATOR 알림 하나. 서버는 승인을 40자 head SHA 전체에 묶고, 새 head가 오면 만료시키며, 클릭 때 조건을 다시 확인한다(기존 DUTY G2 MERGE가 `mergeVerdictOf`에서 한다). 낡은 카드의 클릭은 거절된다.

- **K1: 호스팅 migration과 라이브 데이터.** 카드는 새 migration 버전마다 모델 둘이 쓴 쉬운 말 요약, 파괴적 구문 목록(`DROP`, `TRUNCATE`, 조건 없는 `DELETE`, 열 타입 변경), 대상 프로젝트 이름, 그 버전이 이미 적용됐는지(atc가 읽는다. ATC-329), 리뷰 판정을 보인다. migration은 SUPERVISOR가 자기 도구로 적용하고, atc는 적용된 버전을 알아보고 머지한다. atc가 SUPERVISOR의 클릭 아래 직접 적용해도 되는지는 질문이다(10절 D6).
- **K2: 비밀, 결제·법적 문구, 권리.** 카드는 추가·변경된 환경 키의 이름(값은 절대 아님), 결제·법적 문구의 diff, `Risk: Rights` PR의 증거(라이선스나 출처 문구)를 보인다. 비밀 값은 절대 찍지 않는다.
- **K3: guard, 권한, `.claude/`, 자율 규칙.** 카드는 권한 집합의 기계 계산 차이(allow 추가, deny 제거, hook 제거), 바뀐 K3 경로 목록, 모델 둘이 쓴 "무엇을 넓히나" 문장을 보인다. 넓어지는 것은 서술이 아니라 계산한다: allow 집합이 커지거나 deny 집합이 줄면 카드가 그 말 그대로 적는다.

## 7. SUPERVISOR의 주간 보고

기존 기록으로 C8이 만드는 한 쪽짜리 보고이고, NETWORK 탭(이미 착륙 대기를 보인다)의 블록과 주 1회 ANNUNCIATOR 알림으로 보인다. 푸는 결정은 여기서 한다.

| 숫자 | 출처 |
|---|---|
| AIRPORT별, 레인별(AUTOLAND, MCC, 손) 머지한 PR | `autoland.jsonl`, `mcc.jsonl`, GitHub 머지 목록 |
| 사유별 남은 SUPERVISOR 머지 | 제외 로그(조사 W1) |
| 열고 머지까지 중앙값과 p90 | LOGBOOK `landingWaitMin` |
| 머지 100건당 빨간 `main` head, 초록까지 시간 | `main` push 실행 |
| 72시간 안의 revert·hotfix PR, 착륙한 자동 revert와 결과 | GitHub, C4 기록 |
| 두 레인의 일치, 불일치와 끝난 모양 | `landing-reviews.jsonl`, `autoland-reviews.jsonl`, 둘째 레인 로그 |
| 감사 표본: 감사한 head, P0·P1 지적 | C7 기록 |
| breaker 상태와 조이거나 푼 모든 사건 | C6 기록 |
| 머지당 비용(리뷰 토큰, FUEL) | FUEL, judge 로그 |
| K1, K2, K3 승인: 개수와 기다린 중앙값 | C9 기록 |
| 쓴 brake(HOLD, 수동 GROUND STOP) | `autoland.jsonl`, `atfm` 기록 |
| DISPATCH와 FLEET PLAN: 자동 대 수동 일치 | `proposals.jsonl`, `fleet-plan.jsonl` |

## 8. 구현 순서

통제는 대신하는 게이트가 사라지기 전에 서고, 단계마다 작업 지시서(제목, 범위, 예상 등급), shadow로 도는 법, 가도 좋다고 정하는 측정을 적는다. 작업 지시서는 여기에 적고 Linear에는 만들지 않는다. DUTY나 ENGINEERING이 만든다. 등급은 `deploy/landing-tier.mjs`를 따른다: AUTOLAND·MCC·LANDING 등급 규칙의 변경은 K3 파일이라 SUPERVISOR를 한 번 거친다.

### 0단계: 잰다(이번 주, 게이트 변경 없음)

- **WO-1 제외 로그.** AUTOLAND가 주기마다 CLEARED PR·head마다 제외 사유를 한 줄씩 쓰고 하루 개수를 낸다. 등급 `flagged`.
- **WO-2 빠져나간 결함 기록.** 빨간 `main` head, revert·hotfix PR, 뒤늦은 리뷰 지적을 GitHub와 로그에서 주마다 센다. LOGBOOK `reverted` 쓰기를 고친다. 등급 `auto` 또는 `flagged`.
- **WO-3 주간 보고 v0.** 이미 있는 숫자로 7절의 블록. 등급 `auto`.
- shadow: 필요 없음(읽기만). 가: 보고가 사유별 남은 SUPERVISOR 머지를 보인다.

### 1단계: 통제를 shadow로(이번 주)

- **WO-4 shadow 둘째 리뷰 레인.** 다른 벤더 리뷰어가 AIRPORT head마다 리뷰하고 CLEARED에는 세지 않는다. 일치를 기록한다. 등급 `flagged`.
- **WO-5 shadow 리뷰어 쪽 분류.** 머지 리뷰 판정에 이유가 붙은 `securityBoundary`가 생기고 키워드·경로·라벨 결과 옆에 기록된다. 등급 `flagged`.
- **WO-6 breaker v0.** 주기가 빨간 head와 revert를 세고, 문턱을 넘으면 AUTOLAND가 스스로 `merge`에서 `update`로 내려가 알림을 한 번 보낸다. 다시 올리는 것은 SUPERVISOR뿐. 등급 `user`(AUTOLAND 규칙: 이 PR은 SUPERVISOR가 머지한다).
- **WO-7 AIRPORT의 `main` push마다 시험**(통제 C3, VOC 이슈). atc 밖.
- **WO-8 SUPERVISOR 전용 라우트 모두에 Origin 검사**(통제 C12, 1.4절). 등급 `user`(자율을 지키는 서버 라우트, 결정 D10).
- shadow: 넷 모두 기존 게이트 옆에서 돌며 아무것도 바꾸지 않는다. 가: 2단계 참고.

### 2단계: 첫 게이트 절감, 이번 주에 낼 수 있다(4~5일째, 측정이 정한다)

L1, L2, L3, L4가 AIRPORT A에서 **두 레인이 head를 통과시키고 분류기가 일치할 때** 위임 가능해진다. AIRPORT PR의 SUPERVISOR 머지를 줄이는 첫 단계다: 보안 게이트가 건드리던 PR의 79%에 해당하는 `Risk: Contract`, `Risk: Security`, `rating:SEC`, 경로, 키워드 제외를 없앤다.

- **WO-9 이중 리뷰 위임.** C1이 일치하면 `mergeExclusionOf`가 L1–L4를 푼다. L5–L9는 남는다. 등급 `user`(AUTOLAND 규칙).
- 가를 정하는 측정(지금 적어 둔다): shadow 레인에서 head 50개 이상, 일치율 90% 이상. 감사 표본(C7, shadow로 돌림)에서 두 레인이 모두 통과시킨 head에 P0·P1 놓침 없음. breaker v0 가동. C3 가동. 하루 약 17건이면 head 50개는 약 3일이다.
- 기대 효과: AIRPORT A의 SUPERVISOR 머지가 주 약 117건에서, K1 migration PR(replay로 16%, 한 번 클릭이거나 이미 적용됐으면 자동), K2, 그리고 통제가 서기 전의 L8, L9의 잔여로 줄어든다(대략 PR의 20% 이하. WO-1이 잰다).
- 되돌림: breaker, 또는 제외 규칙을 되살리는 한 번 클릭.

### 3단계: 자동 revert와 breaker v1

- **WO-10 자동 revert 레인(C4).** 먼저 제안으로(SUPERVISOR가 보는 revert PR 초안, 아무것도 착륙 안 함), 그다음 같은 레인이 착륙시킨다. 등급 `flagged`.
- **WO-11 breaker v1(C6)과 감사 표본 가동(C7).** 비율별 문턱, 단계로 조임. 등급 `user`.
- 가를 정하는 측정: revert PR이 5건 이상(또는 지난 빨간 head의 replay)에서 맞고 초록. 폭풍 방지 시험에서 폭풍 없음.
- 그다음 L15(GROUND STOP 해제)가 자동이 된다.

### 4단계: 한 번 클릭 승인(C9)

- **WO-12 K1, K2, K3 승인 카드**를 SUPERVISOR QUEUE와 PR drawer에, head에 묶어. 등급 `flagged`.
- 게이트는 남고 비용이 PR 읽기에서 클릭으로 줄어든다. 가: 카드가 읽는 사람에게 필요한 것을 보인다(최근 K1–K3 PR 20건으로 확인).

### 5단계: atc의 `user` 등급을 좁힌다

- **WO-13 state 형식 호환 시험(C13)**과 더하기만 하는 형식 PR을 MCC에 위임. 등급 `user`(LANDING 등급 규칙).
- **WO-14 의존성을 의존성 리뷰와 RTS `npm ci`로**, health check와 ROLLBACK과 함께. 등급 `user`(deploy).
- 가: 최근 형식 PR 30건에서 형식 호환 시험이 초록, 의존성 리뷰가 필수 체크. K3 파일을 뺀 ESCALATE 줄(주 28건)이 줄어든다.

### 6단계: 더 많은 AIRPORT와 DISPATCH 승인

- **WO-15 다른 AIRPORT에 AUTOLAND**를 하나씩, 필수 CI 체크와 C3가 있을 때만. 등급 `user`(`autoland.json`의 airports 목록을 AUTOLAND 규칙이 읽는다. SUPERVISOR가 AIRPORT마다 켠다).
- **WO-16 일치 기반 승인(C14)**을 ASSIGN, CREW CHANGE, SCHEDULE에, 그다음 FLEET PLAN에, LAUNCH는 지출 상한(C11) 아래에서. shadow는 기존 판정 관문(판정 20건에서 80%). 등급 `flagged`.
- P1의 가: CROSSCHECK 일치가 SUPERVISOR의 결정과 결정 100건에서 90% 이상, blind 표본은 그대로.

### 7단계: 검증 레인, FLIGHT 연결, 배포 뒤 검사

- **WO-17 검증 레인(C10)**과 HUMAN CHECK 종류를 차례로 퇴역(CHOICE, DEVICE, 그다음 ACCOUNT). 등급 `flagged`.
- **WO-18 FLIGHT 연결(C15).** 등급 `flagged`.
- **WO-19 호스트가 지원하는 AIRPORT의 배포 뒤 검사와 rollback(C5).** 등급 `flagged`.
- **WO-20 추가 레인의 지출 상한(C11).** 등급 `flagged`.
- 가: 3단계 숫자가 두 주 동안 안정된 뒤.

게이트도 통제도 없는 틈을 두는 단계는 없다: 2단계는 C1, C2, C3, C6 v0, C7이 shadow로 돈 것을 요구한다. 3단계는 수동 GROUND STOP 해제를 없애기 전에 선다. 5–7단계는 3·4단계가 필요하다.

## 9. 위험

| 위험 | 일어날 수 있는 일 | 완화 |
|---|---|---|
| 모델 둘이 같은 사각지대를 가진다 | 둘 다 나쁜 변경을 통과시킨다 | 다른 벤더와 지시(원칙 5), 셋째 리뷰어의 C7 감사, 일치를 지켜볼 숫자로, breaker |
| revert 폭풍 | revert가 `main`을 다시 깨거나 revert가 이어진다 | 한 번에 revert 하나, revert의 revert 금지, 한 시간에 revert 둘이면 breaker(C4, C6) |
| PR 글로 속이는 분류기 | PR이 스스로 무해하다고 서술한다 | 분류기는 diff를 읽고 글은 위험을 올릴 뿐(원칙 6), 결정적 바닥은 남는다 |
| 에이전트가 K3 뒤의 파일을 고친다 | 에이전트가 자기 한계를 넓힌다 | K3 경로는 `user` 등급이고 모든 lander가 거절한다(C12). SUPERVISOR 전용 라우트는 `Origin`을 검사한다. 모든 머지가 GitHub 로그인 하나로 이뤄지므로 GitHub 자체의 리뷰 규칙으로는 강제할 수 없고 atc의 규칙이 해야 한다 |
| 프롬프트 주입이 리뷰어에 닿는다 | PR 글이 리뷰어에게 지시한다(조사 1.6: AI 리뷰 Action의 CVSS 9.4 결함) | 리뷰어는 패킷을 읽고 비밀 없이 돈다. `pull_request_target`에 리뷰 Action을 두지 않는다. PR 글의 지시는 데이터다 |
| 추가 리뷰의 비용 | 두 레인과 감사로 리뷰 토큰이 약 두 배 | 지출 상한(C11), 감사는 10% 표본, 머지당 비용이 주간 보고에 있다 |
| breaker가 흔들린다 | 조였다 풀었다 자주 한다 | 조이기만 한다. 푸는 것은 SUPERVISOR. 사건마다 알림 하나 |
| 속도가 측정을 앞지른다 | 자료가 말하기 전에 게이트가 나간다 | 단계마다 적어 둔 측정과 shadow 실행(원칙 8) |
| 승인 피로 | 한 번 클릭 승인이 쌓인다 | K1–K3뿐이고, 주간 보고가 개수와 기다린 시간을 센다 |
| AUTOLAND와 MCC가 서로를 막는다 | PR이 두 시스템을 기다린다 | AIRPORT마다 lander 하나(기존 규칙) |
| 작은 기준선 | 7일 자료, 빨간 head 2개 | 문턱은 굴러가는 창의 비율로 정하고 첫 보고에서 다시 본다 |

## 10. SUPERVISOR의 결정

권장 기본값을 먼저 적는다. 어느 것도 K1, K2, K3을 바꾸지 않는다.

- **D1 breaker 문턱.** 기본: 어떤 머지 50건에서 `main` head가 3개를 넘게 빨강(기준선 1.7%의 약 3배)이거나, 7일에 revert 2건이거나, 감사에서 P0가 나오면 조인다. 푸는 것은 주간 보고를 읽은 SUPERVISOR만.
- **D2 첫 절감(2단계)의 가 조건.** 기본: shadow head 50개 이상, 일치율 90% 이상, 두 레인이 모두 통과시킨 head에 감사 P0·P1 놓침 없음.
- **D3 리뷰 모델.** 기본: 둘째 레인은 PR 작성 세션과 다른 벤더(작성자가 Claude면 Codex, Codex면 REVIEW 레인), 셋째(감사) 리뷰어는 그 둘이 아니다. 어느 벤더와 요금제로 할지, 하루 리뷰 예산은 SUPERVISOR의 몫이다.
- **D4 AIRPORT 순서.** 기본: AIRPORT A(이미 위임 중), 그다음 atc의 `user` 등급 좁히기(5단계), 그다음 필수 CI 체크가 생긴 다른 AIRPORT.
- **D5 감사 비율.** 기본: 자동 머지된 head의 10%.
- **D6 세 게이트가 끝나는 곳**(질문이며 설계하지 않았다): (a) `.github/`(CI, 필수 체크)는 K3인가? 권장: 그렇다. CI가 통제이기 때문. (b) `deploy/*.service` 유닛은 K3인가? 권장: 그렇다. (c) `package*.json`의 의존성 변경은 게이트인가? 권장: 아니다(의존성 리뷰로 자동화). (d) CHECKRIDE rating 부여(SEC rating이 SEC 작업을 맡을 팀을 정한다)는 K3인가? 권장: 그렇다. (e) 세션이 기다리는 도구 승인 프롬프트는 K3인가? 권장: 그렇다. (f) 이미 적용된 migration(ATC-329)은 K1 밖인가? 권장: 그렇다, 만들어진 대로. (g) atc가 한 번 클릭 승인 아래 migration을 직접 적용해도 되는가, SUPERVISOR가 적용하는가? 권장: SUPERVISOR가 적용한다(atc는 SQL을 돌리지 않는다). 4단계를 돌린 뒤 다시 본다.
- **D7 한 번 클릭 승인이 사는 곳.** 기본: SUPERVISOR QUEUE 행과 PR drawer, ANNUNCIATOR 알림 하나.
- **D8 주간 보고.** 기본: 월요일 오전 9시(현지), NETWORK 블록과 알림 하나.
- **D9 방향 입력은 사람 몫으로 둔다.** 기본: 이슈를 Backlog에서 Todo로 옮기는 것, 아이디어 라벨, DUTY 헌장은 SUPERVISOR에게 남는다(원칙 10).
- **D10 SUPERVISOR 전용 라우트 모두에 Origin 검사**(1.4절). 기본: 한다. 1단계에서, 나머지와 상관없이.
- **D11 brake.** 기본: HOLD, CANCEL, RECALL, 수동 GROUND STOP, 모드 전환은 남고, SUPERVISOR는 언제든 자동화를 내릴 수 있다.
