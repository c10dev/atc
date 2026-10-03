# 자율 운영: PR마다 머지하던 SUPERVISOR를 길에서 빼기

[English](autonomy.md) · **한국어**

상태(2026-10-01): [ATC-333](https://linear.app/vocado/issue/ATC-333)의 설계 초안. SUPERVISOR는 2026-10-01에 자신은 방향(ROUTE, 우선순위, 무엇을 만들지)을 정하고 PR은 읽지 않기로 했고, 사람 게이트를 정확히 셋만 두기로 했다(2절). 이 문서의 어느 것도 만들어지지 않았다. 이미 있는 것은 "현재 사실"에 적었다. 아래 어떤 행에도 완료 표시를 하지 않았다. 머지 뒤 DUTY나 ENGINEERING이 상태를 고친다.

2026-10-02 개정: SUPERVISOR가 화살 방향을 정했고("사람이 화살, 곧 제안을 쏘고, 그 뒤로는 사람의 개입이 사라져야 한다"), 3절의 원칙 열 개를 확정했다. 원칙마다 두 문장 이내이고 무엇이 그것을 강제하는지를 붙였으며, shadow 실행 대신 먼저 켜기를 골랐다(D21). 결정은 10절에 **Decided**로 표시했고, 그날 코드에서 찾은 것은 1.5에 있다. 이 문서의 어느 것도 아직 만들어지지 않았다.

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

로그가 시작된 2026-09-26부터의 개수(약 5.5일) [observed]. CROSSCHECK 숫자는 기록이다: CROSSCHECK는 퇴역한다(D23).

- DISPATCH: ASSIGN 제안 414건, 승인 315건(클릭 285, CROSSCHECK 일치 30), 기각 7건. CROSSCHECK 판정은 agree 73, disagree 17. LAUNCH 승인 89건은 전부 SUPERVISOR.
- FLEET PLAN: 승인 5건(LAUNCH나 REFRESH), 만료 15건. SCHEDULE: 초안 28건, CROSSCHECK 판정 26건.
- Clearance: 513건 발행(INFO 326, GO AROUND 90, LAND 68, FIX 23). 세션 사이에서 오가며 사람이 필요 없다.
- RTS: 8건 거절(`package*.json`이나 systemd 유닛 4, CI가 준비되지 않았거나 없음 4), 146건 실행. HUMAN CHECK: 1건.

### 1.4 SUPERVISOR 전용 규칙에서 인벤토리가 찾은 것

SUPERVISOR만 부를 수 있는 라우트는 localhost `Origin`을 검사하고(`fromThisApp`), `atcctl`에는 그 명령이 없다. 라우트를 읽어 보니 그 검사가 없는 것이 있다: LAUNCH가 아닌 DISPATCH 카드의 승인·기각, DISPATCH와 SCHEDULE 모드 전환, SCHEDULE 승인·기각, ATFM 라우트(`proposals.ts`, `schedule.ts`, `atfm-run.ts`. [watch.md](watch.md)와 [fleet.ko.md](fleet.ko.md)에도 적혀 있다). 이것들이 SUPERVISOR 전용인 까닭은 서버가 거절해서가 아니라 어떤 관제 세션에도 그 명령이 없고 guard가 `curl`을 막기 때문이다. 자율 규칙(K3)은 `7700`에 닿는 다른 길을 찾아낸 세션에도 버텨야 하므로 이것이 중요하다. 보강은 통제 C12이고 10절에 결정이 있다. 2026-10-02에 다시 읽어 보니 RECALL 생성(`proposals.ts`)과 ATFM 라우트 전부가 더 있다. 여기에는 수동 GROUND STOP과 ATFM 스위치가 들어가는데, 스위치는 올릴 수도 있으니 K3 경로다(`atfm-run.ts`에는 `fromThisApp`이 없다).

### 1.5 2026-10-02 개정에서 찾은 것

`999dc89`의 코드와 읽기 전용 로그, 2026-10-02 [observed]:

- **에이전트가 일을 내보낼 수 있다.** DISPATCH는 우선순위가 있는 Todo 이슈를 받는다(`dispatch.ts`). DUTY는 ATC 이슈를 우선순위와 함께 Todo로 만들거나 옮길 수 있고(`duty/CLAUDE.md`, `duty-linear.ts`), OCC는 승인된 SCHEDULE NEW의 Linear 호출을 찍고, ENGINEERING 세션은 Linear에 직접 쓴다. SUPERVISOR가 FLIGHT를 내보냈다는 기록은 없다(원칙 10).
- **글이 위험을 낮추거나 검사를 대신한다.** HUMAN CHECK의 필요와 완료를 PR 본문 줄에서 읽는다(`human-check.ts`). 리뷰·검사 기록 라우트에 호출자 검사가 없다(`landing-review.ts`, `mcc-run.ts`). 작성자가 아닌 GitHub 리뷰는 head에 있으면 리뷰로 센다(`landing.ts`). 브랜치 이름의 모르는 FLIGHT 키가 "FLIGHT 없음" 제외를 푼다. `type:SURVEY|CHECK`와 `tail:` 라벨이 검사를 건너뛰게 한다. 템플릿 줄은 보안 키워드 검사에서 빠진다. 리뷰어 패킷은 제목, 본문, 이슈 글을 데이터 울타리 없이 싣는다. 울타리가 있는 것은 DUTY 패킷뿐이다(원칙 6).
- **판정이 입력에 묶이지 않는다.** `clearances.jsonl`에는 head 칸이 없고(글 안에만 있다), `proposals.jsonl`, `schedule.jsonl`, `judges.jsonl`, `fleet-plan.jsonl`은 판정한 것의 해시를 저장하지 않는다. AUTOLAND가 가장 자주 내리는 결정인 머지하지 않기는 기록되지 않는다(원칙 7).
- **잡은 것만 세는 관문.** MCC의 shadow 관문(`mccGateOf`)은 불일치 55건을 보이지만 가 판단에는 넣지 않는다. Jev 판정을 SUPERVISOR의 결정과 맞대 보면 확신도 0.5에서 기각된 DISPATCH 제안 12건 중 11건을 통과시켰을 것이다(745줄 중 739줄이 replay, 6줄이 shadow)(원칙 2).
- **Origin 검사는 인증이 아니다.** `fromThisApp`(`origin.ts`)은 요청 헤더만 읽는다. 다른 웹사이트가 브라우저를 통해 움직이는 것은 막지만 로컬 프로세스는 막지 못하므로, atc 화면은 아직 인증된 통로가 아니다(원칙 6, 9, 10).
- **flaky 빨강이 lander를 세운다.** 2026-10-02에 머지된 PR과 관계없는 시험이 `main`에서 한 번 실패했고, MCC는 착륙할 수 있는 PR 둘을 붙잡고 SUPERVISOR에게 물었다. 가장 최근 머지를 revert했다면 죄 없는 PR을 되돌렸을 것이다(원칙 3, C4).

## 2. 남는 세 게이트

2026-10-01에 SUPERVISOR가 정했고 2026-10-02에 넓혔다(D14, D15, 원칙 3). 화살 방향에서는 머지 때가 아니라 내보낼 때 선언된 효과로 한 번 승인한다(6절). DUTY 카드 버튼 G2(MERGE)·G3(상태 이동)([duty.md](duty.md))과 헷갈리지 않도록 K1–K3("kept")이라 부른다.

1. **K1: 호스팅 DB에 migration을 적용하거나 라이브 데이터를 바꾸거나 atc 자신의 state 기록을 다시 쓰는 것.** 머지는 되돌릴 수 있지만 잃어버린 데이터는 못 되돌린다.
2. **K2: 비밀과 키(`.env`, 자격 증명), 결제나 법적 문구, 콘텐츠 권리(`Risk: Rights`), atc 통제를 벗어나는 데이터**(비공개 AIRPORT 내용이 공개된 곳으로, 새 외부 전송처, 더 넓은 필드 허용 목록). 코드 품질이 아니라 바깥에 대한 책임이다.
3. **K3: atc 자신의 guard, 권한, `.claude/` 설정, 자율 규칙 자체**(세션이 무엇을 할 수 있는지 정하는 파일. AUTOLAND, MCC, LANDING 등급 규칙 포함), **그리고 게이트, 문턱, 경로, 모드를 푸는 모든 것.** 에이전트는 자기 한계를 넓히는 것을 스스로 승인하지 않는다.

## 3. 원칙

원칙마다 불변식 하나를 두 문장 이내로 적고, 오늘 무엇이 그것을 강제하는지 붙인다: 구현됨, 일부 구현, 또는 **WISH**(아직 강제하는 곳이 없음). 장치(어느 통제, 어느 기록, 문턱)는 4, 5, 7, 8, 10절에 둔다. 용어: **내보내기**(release, 화살)는 FLIGHT를 시작하는 SUPERVISOR의 행위로, 목적지(목표와 완료 조건)와 선언된 K1–K3 효과를 싣는다. **leak**은 내보낸 뒤의 사람 단계다. **floor**(바닥)는 효과가 나기 전에 거절하는 결정적 검사다. **오작동**(misfire)은 통제가 잘못 움직이거나(harmful) 잘못 붙잡는 것(nuisance)이다.

1. **SUPERVISOR는 화살을 쏜다.** 목적지를 정하고, FLIGHT가 낼 수 있는 K1–K3 효과를 내보낼 때 승인한다. 내보낸 뒤의 사람 단계는 모두 leak이고, 세며, 맡을 쪽의 통제가 서면 없앤다.
   *강제:* WISH. leak을 아직 세지 않는다(C8).
2. **통제는 되돌아갈 길과 함께 켠다.** 게이트가 나가거나 사람 단계가 사라지는 것은 그 통제가 끄는 스위치와 오작동 카운터를 첫 시간부터 갖추고 켜졌을 때만이다. 실제 오작동이 한도를 넘으면 게이트는 저절로 돌아오고, 다시 없애는 것은 SUPERVISOR만 한다.
   *강제:* WISH. 통제별 오작동 카운터와 C6의 통제별 복원이 없다.
3. **확인된 신호로 빨리 조이고, 푸는 것은 SUPERVISOR만 한다.** 서버는 규칙을 조이고 레인은 항목 하나를 보류할 수 있으며, 다시 확인해서 거짓으로 밝혀진 trip은 저절로 다시 열린다. 그 밖에 게이트, 문턱, 경로, 모드를 푸는 것은 방향을 계산한 K3 승인이고, 같은 원인으로 7일 안에 두 번째 trip이 나면 먼저 고쳐야 한다.
   *강제:* 일부 구현. AUTOLAND GROUND STOP 걸림, ROLLBACK 뒤 꺼진 RTS, 설정 스위치의 Origin 검사는 있다. C6, 재확인, 저절로 다시 열기, 방향 계산, ATFM·DISPATCH 모드 전환의 Origin 검사, 7일 규칙은 없다.
4. **되돌릴 수 없는 효과는 내보낼 때 선언하고, 나머지는 revert한다.** 변경은 revert하고 다시 배포해서 그 효과가 모두 사라질 때만 되돌릴 수 있다. 한도 없이 되돌릴 수 없는 효과(K1, K2)는 내보낼 때 선언·승인하고 floor가 빌드된 내용을 선언과 맞대며, 한도가 있는 효과는 상한 아래 돌고, 나머지는 정한 시간 안의 revert로 답한다.
   *강제:* 일부 구현. AUTOLAND의 migration·비밀 경로 제외(L5, L6, ATC-329)와 `user` 착륙 등급은 있다. C4, C11의 메시지 상한, C17은 없다.
5. **반복이 아니라 독립.** 리뷰 둘은 모델, 지시, 입력이 다르고 작성자와도 다르며 어느 쪽도 다른 판정을 먼저 보지 않을 때만 둘로 센다. SUPERVISOR의 클릭도 리뷰 하나이지 정답이 아니다. 독립은 일치율이 아니라 심은 결함과 나중 결과에서의 both-miss로 잰다.
   *강제:* 일부 구현. head에 묶인 판정, 허용되는 곳의 다른 벤더 Codex·REVIEW 레인, 잘린 diff를 거절하는 MCC는 있다. diff만 읽는 레인, 판정 가리기, 심은 결함 실행, 단일 리뷰 카운터는 없다.
6. **내보낸 뒤의 글은 의도의 증거일 뿐, 사실이나 권한의 증거가 아니다.** 결정은 계산한 사실(경로, diff, CI, git)과 기록된 SUPERVISOR의 통로를 승인된 내보내기와 맞대어 내린다. 에이전트나 바깥 사람의 글은 위험을 올릴 수는 있어도 낮추지 못하고, 그 안의 지시는 데이터다.
   *강제:* 일부 구현. 경로 등급, 올리기만 하는 `Risk:`·`rating:` 라벨과 키워드, head에 묶인 판정, DUTY의 데이터 울타리는 있다. 1.5의 위반이 남아 있다.
7. **모든 결정은 판정한 것에 묶이고 결과와 이어진다.** 판정은 기계든 사람이든 정확한 입력(head SHA나 내용 해시)과 그 FLIGHT의 내보내기를 붙여 추가하고, 하지 않기로 한 결정은 시작할 때와 끝날 때 남긴다.
   *강제:* 일부 구현. head는 `mcc.jsonl`, 리뷰 로그, `autoland.jsonl`, `human-checks.jsonl`, `rts.jsonl`, FLIGHT RECORDER의 landing·ATFM 이벤트에, FLIGHT 키는 proposals·clearances·judges에 있다. 내용 해시, clearances의 head, 내보내기 id, 제외의 시작·끝 줄(WO-1)은 없다.
8. **먼저 켜고, 그다음 조정.** 통제는 끄는 스위치, 오작동 카운터, 켜기 전에 적은 한도와 함께 바로 켜고 실제 숫자로 조정한다. 라이브 데이터 변경은 먼저 사본에서 리허설한다(C20).
   *강제:* 일부 구현. AUTOLAND, MCC, judge에는 끄는 스위치가 있다. 통제별 오작동 카운터, 적어 둔 한도, migration 리허설은 없다.
9. **brake는 멈추기만 하고, SUPERVISOR만 걸고 푼다.** HOLD, CANCEL, RECALL, STOP, 수동 GROUND STOP, 모드 내리기는 언제든 올 수 있고 아무것도 이를 기다리지 않는다. 풀면 화살은 승인된 봉투로 돌아가고, 그 너머의 재개나 시스템이 건 정지를 푸는 것은 새 화살이나 K3 풀기다.
   *강제:* 일부 구현. AUTOLAND·MCC hold, GROUND STOP 해제, DISPATCH CANCEL, 세션 STOP, 설정은 Origin을 검사한다. RECALL 생성, DISPATCH·SCHEDULE 모드 전환, ATFM 라우트는 하지 않고(C12), 모든 레인이 모든 brake를 지키는지 보는 CI 시험이 없다.
10. **화살은 SUPERVISOR만 atc 화면의 클릭이나 세션에 직접 한 말로 쏘고, 목적지와 선언한 K 효과만 싣는다.** 에이전트는 화살을 제안으로 그리되 스스로 내보내지 못하고, 내보낸 뒤 방향 질문을 만난 FLIGHT는 정해 둔 기본값으로 가거나 새 화살로 돌아온다.
   *강제:* WISH. DISPATCH는 Linear 상태와 우선순위를 읽는데 DUTY, OCC, ENGINEERING이 둘 다 정할 수 있고, SUPERVISOR의 통로를 적은 내보내기 기록이 없으며(C18), 화면 통로도 아직 인증되지 않았다(1.5).

## 4. 게이트 인벤토리

atc가 사람의 결정을 요구하거나 제안하는 모든 곳을 영역별로 묶었다(sub-agent가 문서와 라우트를 읽었고, 착륙 규칙은 `server/landing.ts`·`server/autoland.ts`와, 개수는 로그와 대조했다). "7일"은 로그가 있는 곳의 개수이고 "not logged"는 그 게이트의 기록이 없다는 뜻이다. 판정: **keep**(K1, K2, K3만), **automate**(게이트가 기계 판단이 되고 통제를 적는다), **remove**(통제가 돌면 게이트가 사라진다), **brake**나 **direction**(게이트가 아님, 원칙 9와 10), **floor**(사람 없이 결정적으로 거절), **release**(SUPERVISOR의 화살, 원칙 10). 통제 칸은 5절의 통제 하나를 가리키며, 판정이 효력을 내기 전에 먼저 선다(순서는 8절).

### 4.1 착륙과 머지

| ID | 게이트 · 위치 | 막는 것 | 7일 | 판정 | 먼저 서는 통제 |
|---|---|---|---|---|---|
| L1 | `Risk: Contract`와 `Risk: Security` 라벨, 티켓이나 PR(`mergeExclusionOf`, `externalGateOf`. `autoland.ts`, `landing.ts`) | 계약·보안 변경이 리뷰 하나로 머지됨 | 오늘 CLEARED PR 2건이 붙잡힘. replay에서는 머지 121건에 PR 라벨 0건(티켓 라벨은 오프라인에서 못 읽음) | **automate** | C1 이중 리뷰, C2 분류기, C4 자동 revert, C6 breaker, C7 감사 |
| L2 | `rating:SEC` 티켓 라벨(같은 함수) | SEC 작업이 더 조심하지 않고 머지됨 | not logged | **automate** | C1, C2, C4, C6, C7 |
| L3 | 보안 경로: auth, session, RLS와 policy, admission, functions, middleware(`securityPathOf`) | 접근 통제 변경이 눈에 안 띄고 머지됨 | replay: 머지 121건 중 44건(36%) | **automate**: 경로는 C2의 입력이 된다. 비밀 경로와 migration 경로는 L5, L6을 따른다 | C1, C2, C4, C6, C7 |
| L4 | PR·FLIGHT 글의 보안 키워드(`securityWordOf`, `SECURITY_WORDS`) | 말로 적힌 보안 변경 | replay: 121건 중 94건(78%), 키워드만 51건(42%) | **remove**, 카운터와 함께 켠 C2가 키워드가 잡은 PR 중 사람이 원했을 것을 모두 표시한 뒤 | C2 diff 분류기(켜고 셈), C1 |
| L5 | migration과 SQL 경로(`migrationPathOf`, `hostedDb` migration 게이트 ATC-329) | migration이 호스팅 DB에 적용되기 전에 머지됨 | replay: 121건 중 19건(16%) | **keep**(K1), 내보낼 때 선언: floor가 빌드된 migration을 선언과 맞대고, 맞으면 atc가 적용한다(D6 g). 선언되지 않았거나 분류할 수 없는 구문은 새 화살 | C9 내보내기 선언, C18, C20 리허설 |
| L6 | 비밀과 키 경로(`secretPathOf`: `.env*`, 자격 증명, 키, 인증서) | 자격 증명이 저장소에 들어옴 | replay: 121건 중 0건 | **keep**(K2), 내보낼 때 선언 | C9, C17 |
| L7 | `Risk: Rights` 라벨, 결제나 법적 문구 | 바깥에 대한 책임(K2) | not logged | **keep**(K2), 내보낼 때 선언 | C9 |
| L8 | PR에 FLIGHT 없음(`gate.hard`) | 아무도 시키지 않은 변경, 추적 불가 | not logged | **automate** | C15 FLIGHT 연결(DUTY나 DISPATCH가 FLIGHT를 잇거나 연다. 없으면 SUPERVISOR가 아니라 DUTY에게 간다) |
| L9 | 파일 100개 이상이거나 파일 목록을 못 읽음(`mergeExclusionOf` 5단계) | 판단하기엔 너무 큰 diff | not logged | **automate** | C1의 full 등급(리뷰어를 더, diff 전체 패킷), C7. 조사 W7의 크기 힌트 |
| L10 | HUMAN CHECK 종류 CHOICE, ACCOUNT, DEVICE(`human-check.ts`, `/api/human-check`) | 사람이 판단해야 하는 UI 변경 | 1건 | **automate**: CHOICE는 flag나 preview 뒤로, DEVICE는 기기 smoke 실행으로, ACCOUNT는 K1·K2에 닿지 않는 한. **Decided:** 필요는 바뀐 경로로 계산하고 완료는 atc 화면에서 만든 기록으로만 센다. PR 본문 줄은 필요를 올리기만 한다 | C10 검증 레인과 증거 패킷, C4, C6 |
| L11 | MCC ESCALATE(`mcc-run.ts`, `docs/mcc.md`): 모델이 PR을 `user`로 올림 | 의심, state 형식 변경, 되돌리기 어려운 변경 | 28줄(PR 27건) | 더하기만 하는 state 형식 변경과 되돌릴 수 있는 변경은 **automate**, PR이 K3에 닿으면(L12) **keep** | C13 형식 호환 검사, C1, C4 |
| L12 | guard, hooks, `.claude/`, 루트 `CLAUDE.md`, `rulebook/`, `*guard*.mjs`, `deploy/landing-tier.mjs`의 `user` 등급(`landing-tier.mjs`) | 세션이 자기 한계를 넓힘 | 위 28건에 포함 | **keep**(K3) | C9, C12 |
| L13 | `.github/`, `package*.json`, `deploy/` 유닛의 `user` 등급 | CI·의존성·서비스 유닛 변경이 눈에 안 띄고 착륙 | 위 28건에 포함 | `.github/`와 `deploy/` 유닛은 **keep**(K3), `package*.json`은 **automate**. K3의 끝은 질문 D6(a–c) | 남는 부분은 C12, `package*.json`은 C16 의존성 리뷰 |
| L14 | MERGE 클릭(DUTY G2): SUPERVISOR가 `user` 등급 PR을 머지(`pr-merge-run.ts`, `mergeVerdictOf`) | 틀렸거나 낡은 head를 머지 | 따로 기록 안 됨 | **remove**: 머지 때 카드가 없다. K3 효과는 내보낼 때 선언하고(C9), 선언을 넘는 빌드된 변경은 새 화살 | C9, C18 |
| L15 | GROUND STOP 해제: SUPERVISOR가 걸린 stop을 푼다(`autoland-run.ts`, ATC-330) | 깨진 `main`에 머지 | 걸린 적 0건 | **automate**: revert 뒤 초록 head가 풀어 준다 | C3 main 시험, C4 자동 revert, C6 |
| L16 | 리뷰 레인 가용성: Codex 한도나 제외로 PR이 리뷰 없이 남음(`landing.ts`) | 리뷰 없는 PR | 재리뷰 요청 13건 중 11건이 REVIEW로 | **automate**. **Decided(D20):** 리뷰 둘이 필요한 PR에서 레인 하나가 빠지면 리뷰 하나로 통과하고, 단일 리뷰로 기록해 센다 | C1이 둘째 레인을 준다. 지출 상한 C11 |
| L17 | stacked PR과 STRANDED 경보를 SUPERVISOR가 손으로 고침(`docs/occ.md`) | `main`에 닿지 못한 머지 | not logged | **automate** | C4: revert·착륙 레인이 stacked PR의 base가 머지되면 retarget·rebase도 한다 |
| L18 | STAND 보유자가 없는 GO AROUND·FIX의 손 RELAY(`supervisor-queue.ts`) | 갈 곳 없는 알림 | relay 14줄 | **automate** | C15: DUTY가 맡아 FLIGHT를 열거나 다시 연다. 드문 경우 |
| L19 | 모드 전환: AUTOLAND `off/update/merge`, `reviewedSecurity`, MCC 모드, `teamsMerge`, `hostedDb`, `externalReview.security`(설정 창) | 동의 없이 머지를 위임함 | 전환 1건(delegate) | 올리는 것은 **keep**(K3), 방향을 계산하는 풀기(원칙 3). 내리는 것은 brake(원칙 9) | C6, C12 |
| L20 | SUPERVISOR가 거는 PR의 HOLD(AUTOLAND와 MCC), CANCEL, RECALL, 세션 STOP | 잘못된 것을 멈춤 | HOLD 2줄 | **brake**(원칙 9). TOWER의 clearance cancel 같은 레인 자신의 보류는 원칙 3의 항목 보류이지 brake가 아니다 | 필요 없음 |
| L21 | 공개 저장소의 공개: push한 브랜치, PR 본문, 댓글은 곧바로 공개된다 | 비공개 AIRPORT 내용이나 비밀이 공개됨. revert는 공개를 되돌리지 못한다 | not logged | push와 PR 생성 때 **floor**. 걸리면 K2(D14) | C17 공개 전 검사기 |
| L22 | AIRPORT 데이터의 새 외부 전송처(리뷰 레인, judge)나 더 넓은 필드 허용 목록 | atc 통제를 벗어나는 데이터 | 오늘은 `judges.jev`가 그런 스위치 | **keep**(K2), 내보낼 때 선언(D14) | C9, C12 |
| L23 | 에이전트가 다시 만들 수 없는 것을 지움(이슈, 기록, 머지 안 된 작업이 있는 브랜치) | 되돌릴 수 없는 손실 | not logged | **floor**: 어느 에이전트도 지우지 않는다. DUTY는 이미 지우거나 닫지 못한다 | C12 |

### 4.2 배포

| ID | 게이트 · 위치 | 막는 것 | 7일 | 판정 | 통제 |
|---|---|---|---|---|---|
| D1 | RTS를 시작하는 UPDATE bar 클릭(`update-run.ts`) | 배포 시점 | `land+rts`에서 배포는 대부분 자동. 클릭은 따로 안 센다 | **remove**(기다리는 것이 없다) | RTS health check와 ROLLBACK, 이미 있음 |
| D2 | `package*.json` 의존성 변경에 대한 RTS 거절(`deploy/rts.mjs`) | 사람 없이 `npm ci` | 4건 거절(유닛 포함) | **automate** | C16 필수 체크인 의존성 리뷰, 그다음 health check와 ROLLBACK이 있는 RTS 안의 `npm ci` |
| D3 | `deploy/*.service` 유닛에 대한 RTS 거절(`daemon-reload`) | 서비스 유닛이 무엇이 어떤 권한으로 도는지 바꿈 | 위에 포함 | **keep**(K3: 서비스가 할 수 있는 일을 정한다) | C9 |
| D4 | ROLLBACK 뒤 SUPERVISOR가 MCC 모드를 다시 고를 때까지 RTS가 꺼진 채(`docs/mcc.md`) | rollback 반복 | rollback 0건 | **keep**(K3, 배포의 breaker이고 푸는 것은 SUPERVISOR). 저절로 다시 열리지 않는다(D12) | C6 |
| D5 | 배포로 죽은 세션을 손으로 다시 띄움 | 잃은 작업 | 0건 | **automate** | C16: health check가 찾은 죽은 세션을 다시 띄움(CONTROL RECYCLE 방식). 3조건 검사가 이미 알아본다 |
| D6 | AIRPORT 배포: 배포 뒤 검사가 없다 | AIRPORT의 나쁜 배포 | 해당 없음 | **통제 없음** | C5 호스트가 지원하는 곳의 배포 뒤 검사와 rollback |

### 4.3 DISPATCH, FLEET, SCHEDULE

| ID | 게이트 · 위치 | 막는 것 | 개수 | 판정 | 먼저 서는 통제 |
|---|---|---|---|---|---|
| P1 | ASSIGN, RELEASE, CLASSIFY 승인·기각(`proposals.ts`, [dispatch.ko.md](dispatch.ko.md)) | 틀린 AIRCRAFT-FLIGHT 짝 | 승인 315건(클릭 285), 기각 7건 | **automate**. **Decided(D22):** planner의 결정적 필터와 C11 상한을 통과하는 ASSIGN 카드는 모두 서버가 승인한다. CROSSCHECK 일치도 blind 표본도 없다. RELEASE와 CLASSIFY는 열려 있음 | planner 필터, C11 상한, DISPATCH 오작동 카운트 |
| P2 | LAUNCH 카드 승인(`proposals.ts`, Origin) | 사용량을 쓰는 세션 시작 | 89건, 전부 SUPERVISOR | **automate**. **Decided(D22):** C11 상한 안의 LAUNCH 카드는 서버가 승인한다 | C11 지출 상한(FUEL hold, `ATC_MAX_LAUNCHED`) |
| P3 | FLEET PLAN 승인과 판정(`fleet-plan-run.ts`) | 사용량 지출, 낡은 제안 | 승인 5건, 만료 15건 | **automate**. **Decided(D23):** 사람도 CROSSCHECK 일치도 없이 C11 상한 아래 돌고 오작동을 센다([ATC-370](https://linear.app/vocado/issue/ATC-370)) | C11, 오작동 카운트 |
| P4 | CREW CHANGE 승인과 "전달함"(`crew-change.ts`) | 동의 없이 돌고 있는 팀의 CREW를 바꿈 | not logged | **automate**. **Decided(D23):** CROSSCHECK 일치 없이, 오작동을 센다 | 오작동 카운트 |
| P5 | SCHEDULE 작업 승인·기각·판정(CLASSIFY, NEW, CLOSE, TAIL, WAYPOINT. `schedule.ts`) | 틀린 티켓 수정 | 초안 28건, CROSSCHECK agree 30, disagree 9 | **automate**. **Decided(D23):** 사람도 CROSSCHECK 일치도 없이. NEW 초안은 제안으로 Backlog에 두고(원칙 10), ROUTE와 TARGET은 제안으로 남으며, 오작동을 센다([ATC-370](https://linear.app/vocado/issue/ATC-370)) | 오작동 카운트 |
| P6 | 전달 안 된 FLIGHT PLAN과 CLEARANCE의 손 전달 | 전달하지 못한 메시지 | undelivered 10줄 | **automate** | 살아 있는 세션 id로 전달하고 재시도, 그래도 안 되면 DUTY 알림([ATC-353](https://linear.app/vocado/issue/ATC-353)) |
| P7 | NEEDS YOU: 도구 승인 프롬프트에서 막힌 세션 | 권한 결정을 기다리는 세션 | 경보라서 여기서 세지 않음 | 권한 규칙 자체는 **keep**(K3). **Decided(D24):** AIRCRAFT는 프롬프트에서 기다리지 않는다. LAUNCH 때 넘기는 atc 정책 hook이 STAND 안의 안전한 동작은 허용하고 나머지는 거절해 세며, FLIGHT가 끝났는데 30분 넘게 PENDING·HUNG인 AIRCRAFT는 멈춘다([ATC-369](https://linear.app/vocado/issue/ATC-369)) | 정책 hook, C12 |
| P8 | SUPERVISOR CONFIRM AT AIRCRAFT(`user` 등급 FLIGHT의 go) | go 없이 진행하는 `user` 등급 FLIGHT | 1줄 | **keep**(K3) | C9 |
| P9 | DISPATCH, SCHEDULE, FLEET PLAN, ATFM, CONTROL RECYCLE, FUEL hold, REPOSITION, JEV, SQUELCH 모드 전환 | 측정 전에 자동화를 켬 | judges 모드 1줄 | 올리는 것은 **keep**(K3), 방향을 계산하는 풀기(원칙 3). 내리는 것은 brake(원칙 9) | C6, C12 |
| P10 | ATFM 스위치와 `s3` | shadow 한 주 전의 자동 동작 | 세지 않음 | 올리는 것은 **keep**(K3). 내리는 것은 brake | C6, C12 |
| P11 | ATFM 수동 GROUND STOP, GROUND DELAY | 손으로 출발을 멈춤 | not logged | **brake** | 없음 |
| P12 | ADD ACCOUNT, LOGIN, SHARE MEMORY(`accounts-run.ts`) | 자격 증명 | not logged | **keep**(K2) | C9 |
| P13 | CHECKRIDE rating 부여(SEC rating이 SEC 작업을 맡을 수 있는 팀을 정한다) | 추천만으로 팀이 권한을 얻음 | not logged | 부여는 **keep**(K3), 회수는 조이는 것. 질문 D6(d) | C9 |
| P14 | workspace trust 프롬프트, 저장소마다 한 번 | 믿지 않는 폴더의 세션 | 세지 않음 | **keep**(K3) | 없음 |
| P15 | AIRCRAFT의 LAUNCH, STOP, AOG, RETIRE, ENTRY를 손으로 | 플릿의 모양과 사용량 | 위 FLEET PLAN 개수 | **direction**(플릿 설계). 비행 중인 일의 STOP은 brake(원칙 9) | 없음 |
| P16 | RELEASE 화면에서 SUPERVISOR를 기다리는 Backlog 제안(DUTY REVIEW, SCHEDULE NEW. 쏘기 = Todo와 `screen` 발권, 버리기 = Canceled, [ATC-401](https://linear.app/vocado/issue/ATC-401)) | 아무도 고르지 않은 제안이 일이 되는 것 | 나가는 날부터 센다(`BACKLOG` 큐 줄) | **keep**(화살, 원칙 10): SUPERVISOR가 쏜다. 없앨 게이트가 아니라 기다림이 보이게 세는 것. DUTY REVIEW의 트리거 신호는 아니다(제안이 기다린다고 점검이 시작되지 않는다) | C14(P5와 같다) |

### 4.4 방향, DUTY, guard

| ID | 게이트 · 위치 | 막는 것 | 개수 | 판정 | 통제 |
|---|---|---|---|---|---|
| X1 | FLIGHT 상태 이동 Backlog, Todo, Canceled(DUTY G3 버튼, `flight-state-run.ts`) | 잘못된 Linear 전이, 아무도 내보내지 않은 일을 에이전트가 시작 | not logged | **release**(원칙 10): 우선순위가 붙은 Todo 이동은 SUPERVISOR 통로의 내보내기 기록이 있을 때만 FLIGHT를 시작한다. 기록 없는 에이전트의 Todo 쓰기는 제안이다 | C18 내보내기 기록 |
| X2 | IDEAS: GitHub의 `idea` 이슈에 라벨 달기 | 검토 안 된 일 | not logged | **direction** | 없음 |
| X3 | DUTY 헌장 확정, 상시 결정, retire, dismiss(`duty-api.ts`) | DUTY가 틀린 브리프로 움직임 | 7일에 초안 1건 | **direction** | 없음 |
| X4 | DUTY L1 스위치 `duty.json` `l1`. DUTY는 L2–L4를 받지 않는다 | DUTY가 권한을 얻음 | 0건 | **keep**(K3) | C12 |
| X5 | guard: `controller/guard.mjs` 프로필, `occ/*guard*`, `duty/guard.mjs`, `mcc/*guard*`, `crosscheck/read-guard.mjs`, `hooks/` | 한 역할이 다른 역할의 명령을 돌림 | 막은 줄 세지 않음 | **keep**(K3) | C12 |
| X6 | `.claude/`와 루트 `CLAUDE.md` 변경 | 권한·지시 변경 | 위 ESCALATE 28줄에 포함 | **keep**(K3) | C9 |
| X7 | `landing-tier`의 `SIDE_EFFECT` 시험 스캔 | 명령을 돌리는 새 서버 파일이 `auto`로 착륙 | 분류될 때까지 CI가 실패 | **keep**(K3) | C12 |
| X8 | WATCH(설계만, 만들어진 것 없음) | 밤 동안 자율의 범위 | 해당 없음 | **아직 게이트 아님**. 만들면 WATCH의 OPS SPEC은 5절과 8절로 들어온다 | C6 |

게이트가 아니라서 뺀 것: 세션 사이의 clearance, MCC INSPECTION `findings`(작성자가 고치고 클릭 없음), MCC 착륙 조건 L1–L8과 리뷰 레인 자체(기계), HOLD(brake).

### Leak counter 구현 (ATC-363)

세기만 하고 게이트는 바꾸지 않는다. `server/leaks.ts`(순수)가 SUPERVISOR QUEUE 항목마다 leak(원칙 1)인지 exempt인지, 4절의 어느 행인지 정하고, `server/leaks-run.ts`가 60초마다 `leaks.jsonl`에 더한다. leak이 생기면 `open` 한 줄, 두 주기 연달아 사라지면 `close` 한 줄(`heldMin` 포함)이다(스냅샷이 잠깐 깜빡여도 두 번 세지 않는다). 주기마다 쓰지 않는다. `GET /api/leaks?days=7`과 METRICS → LEAKS가 지난 7일을 종류별로 "통제 있음"과 "통제 없음"으로 나눠 보인다.

| 큐 kind | 행 | 통제 | 세는 방식 |
|---|---|---|---|
| PROPOSAL (ASSIGN·RELEASE·CLASSIFY / LAUNCH) | P1 / P2 | C14 / C11 | leak |
| SCHEDULE, FLEET PLAN | P5, P3 | C14 | leak |
| HUMAN CHECK | L10 | C10 | leak |
| LANDING: MCC ESCALATE / 그 밖의 이유로 SUPERVISOR가 머지 | L11 / L14 | C13 / C9 | leak |
| LANDING: `user` 등급(K3) / SUPERVISOR HOLD | L14 / L20 | — | exempt (K3, brake) |
| UPDATE | D1 | RTS(있음) | leak, 통제 있음 |
| NEEDS YOU: 도구 승인 프롬프트 / 그 밖의 막힘 | P7 | — / C9 | exempt (K3) / leak |
| RELAY, UNDELIVERED | L18, P6 | C15, C14 | leak |
| GO | P8 | — | exempt (K3) |

기록은 `kind`, `gate`, `control`, `controlBuilt`, `flight`, `since`와, ATC-362 릴리스 기록이 생기기 전까지 `null`인 `release` 칸을 담는다. 어느 통제가 섰는지는 `leaks.ts`의 `CONTROLS` 표가 정한다. 통제가 서면 거기 플래그만 고치고, 그 뒤의 새 leak은 "통제 있음"으로 간다.

### 사람 없는 SCHEDULE·FLEET PLAN (ATC-370)

P3·P5 행을 자른다(K3, 2026-10-02 SUPERVISOR 승인: "live first"). `server/autonomy-auto.ts`(순수)가 정하고 `server/autonomy-auto-run.ts`가 읽고 쓴다. 둘 다 서버 안에서만 돈다(바꾸는 HTTP 길도 `atcctl` 명령도 없다).

- **SCHEDULE.** 서버가 1분마다 열린 CLASSIFY·TAIL·CLOSE·WAYPOINT·NEW 초안을 SUPERVISOR 판정도 CROSSCHECK 일치도 없이 승인한다(`via: "auto"`, 발부는 S2 흐름대로 OCC). PRIORITIZE·ROUTE·TARGET은 제안으로 남는다(방향, 원칙 10). NEW 초안은 이슈를 **Backlog**에 만든다(발부 호출의 `state: "Backlog"`). Todo로 푸는 것은 SUPERVISOR뿐이다(ATC-362). CLOSE는 승인하지만 atc는 여전히 이슈를 Done으로 옮기지 않는다(서버도 OCC도 쓰는 길이 없다): SCHEDULE 탭의 "LINEAR에서 직접 DONE" 목록에 남는다. 하루 상한 `autoApproveMax`가 CROSSCHECK 일치 자동 승인과 함께 센다.
- **FLEET PLAN.** 서버가 주기마다 열린 LAUNCH·STOP·RESTART·REFRESH·AOG 제안을 승인 단추와 같은 실행기(`by: "auto"`)로 실행한다. 그래서 조건이 바뀜 검사, `ATC_MAX_LAUNCHED`, FUEL hold, ACCOUNT 로그인을 실행기가 다시 본다. ENTRY·ACCOUNT CHANGE·REPOSITION(자기 스위치)·RETIRE·RETURN과 데스크톱 세션의 REFRESH는 제안으로 남는다. 덧붙인 상한: 굴러가는 24시간에 자동 적용 전체 `autoApproveMax`, LAUNCH·RESTART·REFRESH `autoLaunchMax`(DISPATCH 자동 LAUNCH도 함께 센다), 그리고 서버가 30분 안에(실패는 60분) 건드린 AIRCRAFT는 쉰다.
- **스위치.** `schedule.json`의 `auto`와 `fleet-plan.json`의 `auto`, `on`·`off`, 없으면 `on`(이 PR이 들어가면 둘 다 켜진다). `PUT /api/settings`(`scheduleAuto`, `fleetPlanAuto`)로만 쓰고 화면의 Origin(`fromThisApp`)이 있어야 받는다. 설정 창 → OPERATIONS → SCHEDULE·FLEET PLAN AUTO. 바꾸면 FLIGHT RECORDER에 남는다.
- **오작동.** `auto-actions.jsonl`은 서버가 한 일, `misfires.jsonl`은 되돌려진 것을 사건마다 한 번 적는다. SCHEDULE: 자동 승인한 초안이 APPLIED가 된 뒤 라벨·TAIL이 되돌려졌거나 CLOSE가 다시 열렸거나 같은 FLIGHT의 같은 종류 뒤 초안이 어긋나는 값을 낸 것(3일 창). FLEET PLAN: STOP 뒤 1시간 안에 같은 AIRCRAFT의 LAUNCH, 1시간 뒤에도 노는 LAUNCH(스냅샷 점검이라 상한 값), 6시간 안의 세 번째 RESTART·REFRESH. `GET /api/autonomy/auto?days=14`가 스위치와 하루별 개수(UTC), 최근 20건을 준다.
- **만들지 않은 것.** 오작동 개수 화면(지금은 API와 파일이 기록), CLOSE를 Done으로 옮기는 길, ATC-369와 STOP 규칙을 하나로 합치기.

### DISPATCH 자동 운항 구현 (ATC-367)

SUPERVISOR가 2026-10-02에 승인한 K3 완화: 서버가 planner 필터와 상한을 통과한 모든 ASSIGN·launch 카드를 승인한다. CROSSCHECK 단계, blind 표본, SUPERVISOR 카드가 없다. 스위치는 `dispatch.json`의 `autoDispatch`(기본 on, `fromThisApp`로 SUPERVISOR만, 깨진 파일은 off). 늦게 드러나는 결과는 MISFIRE(`/api/dispatch/misfire`, DISPATCH 탭)로 센다. 4절 P1·P2 행은 더는 SUPERVISOR QUEUE에 오르지 않으므로 leak counter의 PROPOSAL 종류는 0으로 떨어져야 한다. 자세한 것은 [dispatch.md](dispatch.md) "Automatic DISPATCH as built".

### SUPERVISOR 자격 구현 (ATC-373)

통제 C12를 PR로 SUPERVISOR가 고르게 하는 모양, **짝짓기 해시**로 만들었다. localhost `Origin`은 아무것도 증명하지 못한다: 호스트의 어느 프로세스든 그 헤더를 쓸 수 있기 때문이다. 그래서 SUPERVISOR 전용 라우트는 SUPERVISOR 자신의 화면만 가진 비밀도 요구한다.

- **비밀이 있는 곳.** atc 화면(또는 ANNUNCIATOR 앱)이 무작위 256비트 비밀을 만들어 그 기기의 저장소에만 둔다: Mac 브라우저의 `localStorage`, 앱이면 키체인. 쓰기마다 `X-ATC-Supervisor` 헤더로 보낸다. 서버는 비밀을 저장하지도 출력하지도 로그하지도 않고 sha256 해시만 안다.
- **해시가 있는 곳.** `/etc/atc/supervisor.sha256`(`ATC_SUPERVISOR_HASH_FILE`로 바꾼다), 한 줄에 해시 하나라 기기를 여럿 짝지을 수 있다. 파일은 root 소유이고 그룹·모두에게 쓰기가 없어야 한다. 서비스 사용자로 도는 세션은 읽을 수는 있어도 고치지 못한다(호스트에 비밀번호 없는 `sudo`가 없다). 파일이 없거나 비었거나 사용자 소유이거나 쓰기가 열려 있으면 **짝짓기 전이거나 믿을 수 없는 상태라 SUPERVISOR 전용 쓰기는 모두 거절한다**(fail-closed). `ATC_SUPERVISOR_ALLOW_USER_FILE=1`은 시험 서버에서만 사용자 소유 파일을 받는다.
- **막는 것.** `supervisorGate`가 어느 라우트보다 먼저 돈다. `/api/` 아래 `POST`·`PUT`·`PATCH`·`DELETE`는 모두 자격이 필요하다. 단, 에이전트가 `atcctl`·SQUELCH로 정당하게 하는 쓰기의 허용 목록(`server/supervisor-auth.ts`, `server/supervisor-auth.test.ts`가 `controller/atcctl.mjs`와 맞는지 읽어서 확인한다)은 뺀다. 그래서 1.4 점검에서 아무 검사도 없던 라우트(DISPATCH 승인·거절, RECALL 만들기, DISPATCH·SCHEDULE 모드 스위치, SCHEDULE 승인·거절, 모든 ATFM 라우트)와 나중에 찾는 라우트도 기본으로 막힌다. 새 쓰기 라우트는 누가 일부러 허용 목록에 넣을 때까지 SUPERVISOR 전용이다. 라우트마다의 `Origin` 검사는 두 번째 층으로 남는다. 읽기는 막지 않는다.
- **짝짓기.** 서버가 이 기기를 받아들이지 않으면(`GET /api/supervisor/auth`가 `unpaired`·`missing`·`invalid`·`insecure`) 화면에 막대가 뜬다. "자격 만들기"가 비밀을 만들고 호스트에서 한 번 실행할 명령 하나를 보여 준다(해시만 담긴다): `sudo install -d /etc/atc && echo <해시> | sudo tee -a /etc/atc/supervisor.sha256`. ANNUNCIATOR도 자기 비밀로 똑같이 한다.
- **한계를 그대로 적는다.** 이것은 호스트에서 요청을 위조하는 세션을 막는다. root가 될 수 있는 세션(호스트 사용자가 `docker`·`sudo` 그룹이다: `docker`는 `/etc`를 마운트할 수 있고 `sudo`는 지금 비밀번호가 필요하다), 서비스 코드나 유닛 파일을 고치고 재시작을 기다리는 세션, SUPERVISOR의 Mac을 읽는 세션은 막지 못한다. 이것들은 이 검사가 아니라 착륙 규칙(K3)의 일이다. 비밀은 SSH 터널과 loopback에서 평문으로 지나가는데, 같은 사용자의 프로세스는 추가 권한 없이 그것을 엿볼 수 없다.
- **바꾸지 않은 것.** `atcctl`과 guard: 허용 목록의 라우트로 에이전트가 하는 일은 그대로 된다. 기록 형식은 바꾸지 않았다.

### EFFECT CHECK 구현 (ATC-402)

원칙 7은 배포한 FLIGHT가 바꾸려던 것을 바꿨는지 묻는다. 작업 지시서에 `## Measure` 절이 생겼다([rules.ko.md](rules.ko.md) "작업 지시서"): `metric: <종류>:<이름>`, `direction: down|up`, `window: <n>d`(1d~30d), 또는 `None`. 종류는 atc가 이미 기록하는 것이다: `leak:<종류>`·`leak-minutes:<종류>`(`leaks.jsonl`), `misfire:dispatch`, `alert:<alertKind>`(FLIGHT RECORDER의 `alert.raised`), `clearance:<TYPE>`, `flow:<이름>`(ATC-468. `idle-empty-min`은 놀 AIRCRAFT가 있는데 기다리는 Todo FLIGHT가 없던 분의 합, `created-todo`·`todo-release`·`release-launch`는 그 구간을 마친 이슈들의 중앙값. 중앙값은 앞뒤 창 모두 이슈 3건 이상이어야 견준다).

- **평결.** `server/effect-check-run.ts`가 10분마다, 지난 37일 안에 배포됐고 아직 평결이 없는 FLIGHT를 본다(OOOI의 IN, 배포가 없는 AIRPORT는 ON, 되돌려진 ON은 건너뛴다). 본문은 Linear에서 읽고(주기마다 15건까지, 아직 안 읽은 것과 최근 배포를 먼저, `None`을 포함한 해석은 하루 캐시라 후보가 얼마든 정해진 주기 수 안에 모두 본다. 배포 뒤 하루가 안 지난 FLIGHT는 읽지 않는다. metric 이름은 글자·숫자·공백·`-`·`_`·`:` 32자까지라 본문 글이 REVIEW 프롬프트에 들어가지 못한다), `배포 + 창`이 지나면 배포 앞 창의 수와 뒤 같은 창의 수를 견준다(`server/effect-check.ts`의 `judge`): `improved`(적은 방향으로 20% 이상, 하나 이상 움직임), `worse`(반대로 그만큼), `not improved`, `too little data`(그 기록이 앞 창 전체를 덮지 않거나, `down`은 앞 창에 3건 미만, `up`은 앞뒤 합쳐 3건 미만). `None`이나 절이 없거나 모양이 틀리면 평결이 없다.
- **기록.** `effect-verdicts.jsonl`, 추가만: FLIGHT마다 `verdict` 한 줄(처음 것이 이긴다. 측정, 두 수, 이유, 발권 id가 든다)과 `mark` 줄. `releaseIdOf`(`server/release.ts`)는 `<FLIGHT>@<발권 시각>`이고, leak 기록이 붙잡은 FLIGHT의 발권 id를 싣는다(`release`, 전에는 늘 null). 그래서 leak이 그것을 없애려던 FLIGHT에 이어진다.
- **어디에 보이나.** FLIGHT 서랍의 `EFFECT CHECK` 줄(평결, 두 수, **틀림** 버튼), HOME의 `EFFECT` 구역(틀렸다고 표시하지 않은 `not improved`·`worse`, 오작동 수 포함). `GET /api/effect[?flight=KEY]`는 `{ on, verdicts, misfire, open, skipped }`(`skipped`는 지난 주기가 아직 못 읽은 본문 수). DUTY REVIEW 프롬프트가 열린 나쁜 평결을 싣는다(`openEffectLines`). 새 트리거는 없다.
- **스위치와 misfire.** `effect-check.json`의 `on`(기본 on)은 설정 → OPERATIONS → EFFECT CHECK에서만 바꾼다(SUPERVISOR 자격이 있는 요청, `atcctl` 명령 없음). **misfire**는 SUPERVISOR가 틀렸다고 표시한 평결이다(`POST /api/effect/mark {flight, wrong}`, 다른 쓰기처럼 SUPERVISOR 전용): `misfire { verdicts, wrong, share }`.
- **형식**(추가만): `effect-verdicts.jsonl`, `effect-check.json`, `Leak.release`, `ServerSettings.effectCheck`.

## 5. 보완 통제

통제마다 무엇을 알아채는지, 얼마나 빠른지, 스스로 무엇을 하는지, 무엇을 보고하는지 적는다. 사람의 결정을 대신하는 통제는 C1, C2, C4, C6, C10, C15, C16이고(C14는 대체됨), C9와 C18은 K1–K3 승인을 내보낼 때로 옮기며, 나머지는 이들을 받친다.

| ID | 통제 | 알아채는 것 | 속도 | 스스로 하는 일 | 보고 |
|---|---|---|---|---|---|
| C1 | **이중 독립 리뷰.** 같은 head의 리뷰 둘이 모두 통과해야 하며 사람 대신이다(전에 보안·위험 게이트가 붙던 PR). 레인끼리 모델, 지시, 입력이 다르고(한 레인은 PR 본문 없이 diff를 읽는다. 민감한 경로에서 잘린 패킷은 통과하지 못한다), 작성자의 모델 계열과 다르며, 서로의 판정을 보지 않는다(원칙 5, 6). **Decided(D3, D18):** 내용을 다른 벤더에 보낼 수 없는 민감한 PR은 그 AIRPORT에 미리 승인한 외부 모델(내보낼 때 K2)을 쓰고, 없으면 같은 벤더의 다른 모델·지시·입력을 써서 부분 독립으로 세며 그 both-miss를 따로 잰다. 사람 게이트는 없다. 불일치나 P0·P1 지적은 머지를 막고 셋째 리뷰로, 그다음 SUPERVISOR가 아니라 DUTY에게 간다. | 리뷰어 하나가 놓칠 결함. 오늘은 두 레인이 같이 본 head가 없다(조사 2.4) | head마다 몇 분, 둘째 레인은 병렬 | 막고, 셋째 리뷰어에게 묻고, 레인마다 입력 해시와 함께 두 판정을 기록 | 불일치와 끝난 모양, 심은 결함의 both-miss(C7), 단일 리뷰(D20) |
| C2 | **diff 위험 분류기.** 리뷰어가 diff를 보고 변경이 보안·계약 경계에 닿는지 판단해 `securityBoundary`와 이유를 쓰고, 닿는 효과 종류(메시지 생성, 외부 데이터 전송, state 쓰기, 공개 글. 원칙 4)도 적는다. 키워드 규칙은 C2가 오작동 카운터와 함께 켜진 뒤에 빼고, 템플릿 줄은 더 이상 키워드를 숨기지 못한다. 결정적 바닥은 남는다: 비밀 경로, migration 경로, K3 경로. PR 글은 위험을 올릴 수만 있고 내리지 못한다. | 키워드 없는 경계 변경, 아무것도 안 건드리는 PR의 키워드 | 리뷰 안에서 | PR을 C1의 full 등급으로 올림. 내리지는 않음 | 분류기 대 키워드·경로 결과, 둘 다 놓친 경우, 과잉 표시 |
| C3 | **`main`이 push마다 lint와 시험을 돌린다**(AIRPORT 자체 CI. ATC-333에 이어진 VOC 이슈로 추적). GROUND STOP과 revert 레인이 빌드 실패만이 아니라 시험 실패도 보게 한다. | 빌드는 되지만 시험이 실패하는 머지 | push 때 | head의 체크를 실패시킴 | 빨간 head 수 |
| C4 | **자동 revert.** 머지가 `main`을 빨갛게 만들면 lander는 먼저 실패한 job을 한 번 다시 돌린다: 초록이면 그 빨강을 flaky로 표시하고 revert하지 않는다(작업 지시서는 DUTY에게). 다시 빨강이면 원인 머지의 revert PR을 열고, 같은 레인으로 리뷰하고 CI가 초록이면 착륙시키고, 다음 초록 head에서 GROUND STOP을 풀고 DUTY에게 알린다. 안전장치: 한 번에 revert 하나, revert의 revert는 안 함, 한 시간에 revert 둘이면 또 revert하는 대신 breaker(C6)가 조인다(revert 폭풍). | 작성자가 빨리 안 고치는 빨간 `main` | 빨간 head 몇 분 뒤, 목표 D16 | 다시 돌리고, 열고, 착륙시키고, 풀기 | 착륙한 revert, 초록까지 시간, 그 창의 효과, 죄 없는 revert(오작동), 폭풍 |
| C5 | **호스트가 이전 빌드를 승격할 수 있는 AIRPORT의 배포 뒤 검사와 rollback**: 배포 뒤 smoke 요청과 오류율 읽기, 실패하면 rollback. | CI는 통과하고 운영에서 실패하는 배포 | 배포 몇 분 뒤 | rollback하고 GROUND STOP을 건다 | 주간 실패 배포 |
| C6 | **breaker.** 굴러가는 창에서 빨간 head, revert, 감사 지적, 불일치를 각각 확인된 뒤에만 센다(빨강은 실패한 job을 한 번 다시 돌린 뒤에 센다). 문턱을 넘으면 단계로 스스로 조인다: 키워드·경로 게이트 복원, 그다음 AUTOLAND를 `merge`에서 `update`로, 그다음 GROUND STOP. 어떤 통제의 실제 오작동이 한도를 넘으면 그 통제의 게이트도 되살린다(원칙 2). **Decided(D12, D13):** 초록 재실행과 초록 다음 head로 거짓이 밝혀진 trip은 저절로 다시 열린다. 다만 brake와 ROLLBACK 뒤 RTS 꺼짐(D4)은 아니다. 같은 원인으로 7일 안에 두 번째 trip이 나면 머지된 수정이나 작업 지시서 링크가 먼저 있어야 한다. 그 밖의 풀기는 K3 승인이다. | 오르는 결함률, 오작동하는 통제 | 주기마다(90초) | 모드를 내리거나 게이트를 되살리고, 거짓 trip을 다시 열고, 알림 하나 | breaker 상태, 모든 trip과 다시 열기. 저절로 다시 연 것은 자기 오작동으로 센다 |
| C7 | **감사 표본과 심은 결함.** 머지된 PR의 사본에 심은 알려진 결함과 revert된 PR의 replay로 레인마다 놓친 것과 레인 쌍의 both-miss를 잰다. **Decided(D17):** atc PR에서 주 10건으로 시작하고(공개 저장소라 외부 전송 문제가 없다), 주간 보고의 비용을 보고 조정한다. 두 레인과 다른 셋째 리뷰어가 자동 머지된 head의 약 10%를 머지 뒤 다시 리뷰하는 것도 남는다. 그 P0·P1 지적은 breaker에 센다. | C1의 공동 사각지대 | 한 시간 안 | 기록을 쓴다. PR 댓글은 없다 | 레인별 놓침, 쌍별 both-miss, 감사한 head와 지적 |
| C8 | **주간 보고**(7절). 기록에서 센다(원칙 7). leak, 오작동, 이을 키가 없거나 정답이 없는 판정의 비율을 포함한다. | 흐름의 이탈 | 주간 | 보고를 만든다 | 보고 |
| C9 | **K1, K2, K3를 내보낼 때 선언**(6절): SUPERVISOR는 FLIGHT를 내보낼 때 선언된 효과를 한 번 승인한다. floor가 빌드된 내용을 선언과 맞대고, 그 너머의 변경은 FLIGHT를 멈춰 새 화살로 돌아오게 한다. | 승인된 것을 넘는 빌드된 변경 | 내보낼 때와 빌드 때 | 선언 너머를 거절. K1은 맞는 migration을 적용(D6 g) | K 효과가 있는 내보내기, 봉투를 벗어나 생긴 새 화살 |
| C10 | **검증 레인.** 세션이 변경을 돌려(시험, smoke 흐름, preview) 증거를 붙인다. HUMAN CHECK 종류를 대신한다. | 실행 때만 보이는 실패 | 몇 분 | 증거를 붙이고 실패하면 막음 | PR마다 증거 |
| C11 | **지출 상한**: 추가 리뷰와 자동 LAUNCH에 대한 FUEL hold, `ATC_MAX_LAUNCHED`, 하루 리뷰 예산, 우리 세션에 보내는 메시지의 속도 상한(원칙 4). | 비용 폭주, 메시지 홍수 | 결정마다 | 멈춘다 | 머지당 비용, FLIGHT당 메시지 |
| C12 | **K3 보강.** SUPERVISOR 전용 라우트는 모두 localhost `Origin`을 검사하고(1.4의 라우트), AUTOLAND·MCC·RTS는 리뷰가 어떻든 K3 경로를 건드리는 PR을 거절한다. 규칙 파일은 `deploy/` 아래에 두고 그 파일 자체도 `user` 등급이다. 자율 규칙은 데이터이고 손잡이마다 조이는 방향이 선언돼 있어 변경의 방향을 계산한다(모르면 푸는 것으로 센다. 원칙 3). 리뷰·검사 기록은 자기 레인에서 온 것만 받고, 이슈 댓글 작성자를 SUPERVISOR로 치는 것은 설정으로만 한다(원칙 6). Origin 검사는 사이트 간 요청만 막으므로 SUPERVISOR 전용 라우트에는 실제 인증도 필요하다: 에이전트가 읽을 수 없는 자격 증명, 또는 다른 OS 사용자 아래의 서버(1.5). | SUPERVISOR 전용 동작에 닿거나 자기 한계를 고치거나 자기 리뷰를 기록하는 에이전트 | 요청 때 | 거절 | 거절 수 |
| C13 | **state 형식 호환 검사.** CI 시험이 이전 state 파일을 새 코드로 읽고, 더하기만 하는 선택 필드만 허용한다. 더하기가 아닌 형식이나 기존 기록 다시 쓰기는 K1이다(D15). | 기존 state를 고아로 만드는 형식 변경 | CI에서 | PR을 실패시킴 | 시험 결과 |
| C14 | **일치 기반 제안 승인.** **Superseded(D22, D23):** DISPATCH, SCHEDULE, FLEET PLAN, CREW CHANGE는 CROSSCHECK 일치 없이 돌고, CROSSCHECK 세션은 퇴역한다([ATC-371](https://linear.app/vocado/issue/ATC-371)). 앞선 설계의 기록으로 남긴다. | — | — | — | — |
| C15 | **FLIGHT 연결.** FLIGHT 없는 PR은 브랜치 이름으로 이슈에 잇거나 하나를 연다. 못 만들면 DUTY에게 간다. | 추적 불가한 일 | PR을 열 때 | 잇거나 연다 | 연결 안 된 PR |
| C16 | **배포 보강.** 필수 체크로서의 의존성 리뷰, 재시작 전 RTS 안의 `npm ci`(이미 있는 health check와 ROLLBACK과 함께), health check가 찾은 죽은 백그라운드 세션 재기동. | 서비스를 깨는 의존성 변경, 배포로 잃은 세션 | 배포 때 | 설치, 검사, rollback, 재기동 | rollback이나 재기동이 필요했던 배포 |
| C17 | **공개 전 검사기.** hook(K3 파일)이 push와 PR 생성마다, 공개 저장소에 닿기 전에 비밀과 비공개 AIRPORT 식별자를 찾는다. | revert가 되돌리지 못하는 공개(원칙 4) | push 때 | 거절. 걸리면 K2 새 화살 | 주간 걸린 수 |
| C18 | **내보내기 기록.** 내보내기마다 FLIGHT, 선언의 해시, 통로를 기록한다: atc 화면의 클릭(Origin 검사), DUTY 채팅의 SUPERVISOR 메시지(채팅을 나르는 서버가 확인), 다른 세션에 한 말(그 세션이 말과 시각을 적어 증언). DISPATCH는 내보낸 FLIGHT만 받는다. | SUPERVISOR 없이 시작한 일, 거짓 증언 | 내보낼 때 | 내보내지 않은 FLIGHT를 거절 | 통로별 내보내기, 세션별 증언된 내보내기(골라 확인용) |
| C19 | **데이터 울타리.** 모든 리뷰어·관제 패킷은 제목, 본문, 이슈 글, 댓글을 데이터로 감싼다. DUTY 패킷은 이미 그렇다. 리뷰 기준은 고칠 수 있는 글에서 가져오지 않는다. | 글 속 지시가 리뷰어를 움직임(원칙 6) | 패킷 안에서 | 감싼다 | 울타리 없는 패킷(목표 0) |
| C20 | **migration 리허설**(**Decided**, [ATC-368](https://linear.app/vocado/issue/ATC-368)). 호스팅 DB가 있는 AIRPORT마다 라이브 스키마와 최근 데이터 스냅숏을 담은 시험 DB를 둔다. 선언 floor(C9)를 통과하면 atc는 거기에 migration을 적용하고 앱의 smoke 시험을 돌린다. 그다음에야 라이브 DB의 복원 지점을 잡고, 적용하고, 버전을 기록하고, 적용 뒤 검사를 돌린다. 어디서든 실패하면 라이브는 그대로 두고 FLIGHT는 새 화살로 돌아온다. 변경은 더하기 먼저, 파괴는 나중의 migration으로 나눈다. | 데이터에 따른 실패(기존 데이터 위의 제약, 긴 잠금) | 라이브 적용마다 그 전에 | 리허설하고, 적용하고, 검사하고, 복원 | 통과·실패한 리허설, 적용 뒤 실패 |

### C4 구현 결과 (ATC-351, ATC-394로 처음부터 켬)

자동 revert 레인(통제 C4, WO-10을 앞당김)이 **처음부터 켜져 있다(live first, ATC-394): shadow는 없다.** 스위치 하나 `autoRevert`가 `on`(기본: 파일이 없거나 모르는 값이거나 예전 `shadow`여도 `on`) 또는 `off`이고, 파일에 정확히 `off`가 적혀야 레인이 멈춘다. 설정 창(LANDING 탭의 "AUTO REVERT", 다시 켤 때 확인 단계)에서만, `fromThisApp` 설정 길(`PUT /api/settings {autoRevert}`)로 바꾼다. `atcctl` 명령은 없다. 규칙은 순수 함수(`server/auto-revert.ts`의 `revertDecisionOf`, 시험 있음)이고, GitHub을 읽고 쓰는 주기는 `server/auto-revert-run.ts`다. 상태는 `auto-revert.json`(스위치)과 추가만 하는 `auto-revert.jsonl`이다. 둘 다 새 파일이라 기존 형식은 바뀌지 않는다.

- **flake 방어(ATC-394).** revert하거나 lane을 멈추기 전에, 같은 `main` head에서 실패한 GitHub Actions run을 한 번 다시 돌린다(`rerun-failed-jobs`, `rerun` 줄에 run id와 시도 번호). 다시 돌려 초록이면 flake다: `flake` 줄을 쓰고 아무것도 되돌리지 않으며, 그 head는 breaker에 세지 않는다(다시 빨간 head만 `red` 줄을 쓴다). 다시 빨갛고 **또한** 되돌릴 PR 자신의 head 커밋이 머지 전에 초록이었으면(되돌리기 직전에 다시 읽는다) 그 머지가 `main`을 깬 것이라 revert PR을 연다. 실패한 체크가 Actions run이 아니라 다시 돌릴 수 없으면 짐작하지 않고 `hold` 줄을 쓴다. 다시 돌린 것이 45분 안에 끝나지 않거나 PR 자신의 head가 초록이 아니었을 때도 `hold`다.
- **시작.** GitHub을 읽을 때마다(90초) AUTOLAND가 맡은 AIRPORT와 MCC AIRPORT마다, 기본 브랜치 head가 빨가면. head에서 CI가 초록이던 마지막 커밋까지 거슬러 올라가(최대 15커밋, 커밋마다 읽기 전용 상태 호출 하나) 그 뒤에 머지된 것을 본다.
- **어느 머지.** `autoland.jsonl`(`merge` ok)이나 `mcc.jsonl`(`land` ok)에 기록이 있고 GitHub이 그 PR의 머지 커밋이라고 확인한 머지만. 가장 새 머지부터 되돌린다. 그 revert PR이 착륙한 뒤에도 head가 빨가면 다음 주기에 다음으로 새 머지를 되돌린다(revert 머지는 건너뛰고 되돌리지 않는다). 마지막 초록 뒤에 lander 머지가 아닌 커밋(사람의 머지, 직접 push, 읽지 못한 것)이 하나라도 있으면 짐작하지 않고 `hold` 줄을 쓴다.
- **K1·K3.** 되돌릴 PR이 마이그레이션·SQL 경로(`migrationPathOf`)나 착륙 등급이 `user`인 경로(guard, `.claude/`, 루트 `CLAUDE.md`, `.github/`, `package*.json`, `hooks/`, `deploy/` …)를 고쳤거나 파일을 읽지 못했으면 `hold` 줄을 쓰고 거기서 멈춘다. 더 오래된 머지로 건너뛰지 않는다.
- **revert PR.** GraphQL `revertPullRequest`(Draft 아님, force-push·브랜치 삭제·admin 우회 없음). 제목 `Revert PR #n: main went red (auto-revert)`(ATC key가 없어 이슈를 닫지 않는다), 본문에 실패한 체크를 적는다. AIRPORT마다 하나만. 다른 PR과 같은 리뷰·CI를 거친다. MCC AIRPORT의 main 깨짐 GROUND STOP과 AUTOLAND의 걸린 GROUND STOP이 막지 않는 유일한 PR이다(그것이 나가는 길이라서). 나머지 조건(리뷰, CI, base, 등급, HOLD)은 그대로다. GitHub의 revert 브랜치 이름 `revert-<n>-...`이고 `auto-revert.jsonl`에 줄이 있어야 한다. AUTOLAND는 FLIGHT 없이도 받는다.
- **풀기.** ATFM의 main 깨짐 stop은 head가 다시 초록이면 끝난다. AUTOLAND의 걸린 stop은 atc가 revert PR을 연 head에서 걸렸고 다음 head가 초록일 때만 atc가 푼다(기록 `groundstop-clear`, detail `auto-revert`). SUPERVISOR나 다른 이유로 건 stop은 그대로 둔다.
- **breaker.** 1시간 안에 새 빨간 head가 둘째로 나오면 `stop` 줄을 쓴다. atc 자신의 revert 머지가 빨간 것은 세지 않아서 여러 머지를 거치는 연쇄는 한 사고다. `stop`은 AUTOLAND `merge`를 `update`로, MCC 착륙을 끄고(`land`는 `shadow`, `land+rts`는 `rts`), SUPERVISOR 알림 하나(`revert|stop|<airport>|<at>`)를 올리고, SUPERVISOR가 `autoRevert` 스위치를 다시 고를 때까지 되돌리지 않는다. AUTOLAND·MCC를 다시 올리는 것은 SUPERVISOR의 스위치로 남는다.
- **알리기.** SUPERVISOR가 아니라 DUTY에게: `hold`·`revert-opened`·`revert-failed`·`revert-landed`·`stop` 줄이 DUTY brief(`AUTO-REVERT` 구역, 최근 24시간)에 들어간다. 되돌린 PR의 FLIGHT는 마지막으로 그 일을 한 AIRCRAFT에게 FIX relay(`relays.jsonl`, TOWER가 보낸다)를 받고, 실패한 체크가 적힌다. 담당을 못 찾으면 그렇다고 `fix` 줄을 쓰고, 이슈를 되돌리는 것은 DUTY가 한다(atc는 Linear에 쓰지 않는다).
- **날짜별로 센다**(설정 창 AUTO REVERT 줄 아래, 최근 7일 UTC): 연 revert, 잡은 flake(빨갛다가 다시 돌리니 초록), misfire, `hold`·`stop` 줄. **misfire**는 되돌린 PR이 revert가 착륙한 뒤 24시간 안에 그대로 다시 머지된 것이다: atc의 revert PR을 되돌린 PR(GitHub 브랜치 이름 `revert-<우리 revert PR>-…`)이거나, 파일과 바뀐 뒤 blob 해시가 원래 PR과 같은 PR이다. `misfire` 줄을 한 번 쓰고 DUTY brief가 보인다.
- **끄는 스위치.** SUPERVISOR의 `off`는 그대로 있다: 끄면 이 레인은 아무것도 읽지도 쓰지도 않는다.
- 만들지 않은 것: WO-10의 앞 절반(SUPERVISOR가 볼 Draft revert 제안). 레인은 바로 움직이되 flake 재실행, PR head 초록 확인, K1·K3 hold, breaker가 지킨다. 우연히 통과한 재실행이 진짜 깨짐을 가리는 경우는 재실행이 못 잡는다: 그 그물은 breaker다.

### C9: 선언할 수 있는 K3 라벨 (ATC-399)

서버는 `K3[<라벨>]: <통제> | files: <경로>` 꼴의 K3 선언으로만 classifier allow 항목을 만든다(`server/k3-allow.ts`, [dispatch.ko.md](dispatch.ko.md) "K3 발권이 classifier에 닿는 길"). Linear는 이 줄을 대괄호를 이스케이프해 저장한다(`K3\[Security Weaken\]: …`). 줄을 읽기 전에 Markdown 이스케이프를 되돌린다. 아래 표에서 선언 가능이 아닌 라벨은 선언할 수 없다: 그 줄은 읽히지 않은 것으로 세어 항목을 만들지 않고, FLIGHT는 classifier 아래에 남는다. 표는 2026-10-02의 `claude auto-mode defaults`에 있는 `soft_deny` 라벨 전부다(72개, 선언 가능 7개). 다음 발권에서 라벨을 `K3_LABELS`로 옮기고 그 라벨의 "must name"이 요구하는 글을 항목에 넣으면 더해진다.

| soft_deny 라벨 | K3 선언 | 이유 / 항목이 적는 것 |
|---|---|---|
| Git Destructive | 선언 불가 | revert PR로 되살릴 수 없는 데이터를 없앤다. 코드 FLIGHT에는 필요가 없다. |
| Code That Leaks When Run | 선언 불가 | 비밀이나 데이터를 샌드박스 밖으로 내거나 안팎의 길을 연다. 선언할 코드 변경에 필요한 일이 아니다. |
| Code from External | 선언 불가 | 밖의 코드나 패키지를 실행에 들인다. 선언이 판단할 수 없는 공급망 위험이다. |
| Cloud Storage Mass Delete | 선언 불가 | 운영·공유·제3자 시스템에 손댄다. 발권된 FLIGHT는 코드만 다루므로 선언할 효과가 없다. |
| Production Deploy | 선언 불가 | 운영·공유·제3자 시스템에 손댄다. 발권된 FLIGHT는 코드만 다루므로 선언할 효과가 없다. |
| Remote Shell Writes | 선언 불가 | 운영·공유·제3자 시스템에 손댄다. 발권된 FLIGHT는 코드만 다루므로 선언할 효과가 없다. |
| Sensitive Remote Exec | 선언 불가 | 운영·공유·제3자 시스템에 손댄다. 발권된 FLIGHT는 코드만 다루므로 선언할 효과가 없다. |
| Production Reads | 선언 불가 | 운영·공유·제3자 시스템에 손댄다. 발권된 FLIGHT는 코드만 다루므로 선언할 효과가 없다. |
| Blind Apply | 선언 불가 | 운영·공유·제3자 시스템에 손댄다. 발권된 FLIGHT는 코드만 다루므로 선언할 효과가 없다. |
| Protected-Scope IaC Apply | 선언 불가 | 운영·공유·제3자 시스템에 손댄다. 발권된 FLIGHT는 코드만 다루므로 선언할 효과가 없다. |
| Logging/Audit Tampering | 선언 불가 | auto mode가 기대는 검사(로그, TLS, CI, 샌드박스, classifier)를 끈다. 선언이 자기 우회를 승인할 수는 없다. |
| Permission Grant | **선언 가능** | 허가: 누가 어떤 권한을 얻는가 |
| Account & Standing-Rule Changes | 선언 불가 | 운영·공유·제3자 시스템에 손댄다. 발권된 FLIGHT는 코드만 다루므로 선언할 효과가 없다. |
| TLS/Auth Weaken | 선언 불가 | auto mode가 기대는 검사(로그, TLS, CI, 샌드박스, classifier)를 끈다. 선언이 자기 우회를 승인할 수는 없다. |
| Secret-Store Writes | 선언 불가 | 운영·공유·제3자 시스템에 손댄다. 발권된 FLIGHT는 코드만 다루므로 선언할 효과가 없다. |
| DNS / Domain / Cert Changes | 선언 불가 | 운영·공유·제3자 시스템에 손댄다. 발권된 FLIGHT는 코드만 다루므로 선언할 효과가 없다. |
| Security Weaken | **선언 가능** | 약해지는 통제와 그것을 바꾸는 파일 |
| Security Test Removal | **선언 가능** | 어떤 테스트를 없애거나 건너뛰는가(통제 칸이 그것을 적는다) |
| Safety Bypass Flag | 선언 불가 | auto mode가 기대는 검사(로그, TLS, CI, 샌드박스, classifier)를 끈다. 선언이 자기 우회를 승인할 수는 없다. |
| Create Unsafe Agents | 선언 불가 | auto mode가 기대는 검사(로그, TLS, CI, 샌드박스, classifier)를 끈다. 선언이 자기 우회를 승인할 수는 없다. |
| Interfere With Workloads | 선언 불가 | 운영·공유·제3자 시스템에 손댄다. 발권된 FLIGHT는 코드만 다루므로 선언할 효과가 없다. |
| Shared Cluster Mutation | 선언 불가 | 운영·공유·제3자 시스템에 손댄다. 발권된 FLIGHT는 코드만 다루므로 선언할 효과가 없다. |
| CI Bypass | 선언 불가 | auto mode가 기대는 검사(로그, TLS, CI, 샌드박스, classifier)를 끈다. 선언이 자기 우회를 승인할 수는 없다. |
| Modify Shared Resources | 선언 불가 | 운영·공유·제3자 시스템에 손댄다. 발권된 FLIGHT는 코드만 다루므로 선언할 효과가 없다. |
| Irreversible Local Destruction | 선언 불가 | revert PR로 되살릴 수 없는 데이터를 없앤다. 코드 FLIGHT에는 필요가 없다. |
| Unverifiable Deletion Target | 선언 불가 | revert PR로 되살릴 수 없는 데이터를 없앤다. 코드 FLIGHT에는 필요가 없다. |
| Shared Scratch Sweep | 선언 불가 | revert PR로 되살릴 수 없는 데이터를 없앤다. 코드 FLIGHT에는 필요가 없다. |
| Irreversible Deletion (general) | 선언 불가 | revert PR로 되살릴 수 없는 데이터를 없앤다. 코드 FLIGHT에는 필요가 없다. |
| Unverifiable Deletion Scope | 선언 불가 | revert PR로 되살릴 수 없는 데이터를 없앤다. 코드 FLIGHT에는 필요가 없다. |
| Create RCE Surface | 선언 불가 | auto mode가 기대는 검사(로그, TLS, CI, 샌드박스, classifier)를 끈다. 선언이 자기 우회를 승인할 수는 없다. |
| Expose Local Services | 선언 불가 | 비밀이나 데이터를 샌드박스 밖으로 내거나 안팎의 길을 연다. 선언할 코드 변경에 필요한 일이 아니다. |
| External Ingress Tunnel | 선언 불가 | 비밀이나 데이터를 샌드박스 밖으로 내거나 안팎의 길을 연다. 선언할 코드 변경에 필요한 일이 아니다. |
| Credential Leakage | 선언 불가 | 비밀이나 데이터를 샌드박스 밖으로 내거나 안팎의 길을 연다. 선언할 코드 변경에 필요한 일이 아니다. |
| Credential Materialization | 선언 불가 | 비밀이나 데이터를 샌드박스 밖으로 내거나 안팎의 길을 연다. 선언할 코드 변경에 필요한 일이 아니다. |
| Credential Exploration | 선언 불가 | 비밀이나 데이터를 샌드박스 밖으로 내거나 안팎의 길을 연다. 선언할 코드 변경에 필요한 일이 아니다. |
| PII Data Handling | 선언 불가 | 비밀이나 데이터를 샌드박스 밖으로 내거나 안팎의 길을 연다. 선언할 코드 변경에 필요한 일이 아니다. |
| Exfil Scouting | 선언 불가 | 비밀이나 데이터를 샌드박스 밖으로 내거나 안팎의 길을 연다. 선언할 코드 변경에 필요한 일이 아니다. |
| Traffic Redirection | 선언 불가 | 비밀이나 데이터를 샌드박스 밖으로 내거나 안팎의 길을 연다. 선언할 코드 변경에 필요한 일이 아니다. |
| Remote Repoint | 선언 불가 | 비밀이나 데이터를 샌드박스 밖으로 내거나 안팎의 길을 연다. 선언할 코드 변경에 필요한 일이 아니다. |
| Out-of-Place Publication | 선언 불가 | 비밀이나 데이터를 샌드박스 밖으로 내거나 안팎의 길을 연다. 선언할 코드 변경에 필요한 일이 아니다. |
| Sensitive-Source Provenance | 선언 불가 | 비밀이나 데이터를 샌드박스 밖으로 내거나 안팎의 길을 연다. 선언할 코드 변경에 필요한 일이 아니다. |
| Excess Sensitive Detail | 선언 불가 | 비밀이나 데이터를 샌드박스 밖으로 내거나 안팎의 길을 연다. 선언할 코드 변경에 필요한 일이 아니다. |
| Unrequested Artifact Publish | 선언 불가 | 비밀이나 데이터를 샌드박스 밖으로 내거나 안팎의 길을 연다. 선언할 코드 변경에 필요한 일이 아니다. |
| Live-Shared Artifact Sensitive Delta | 선언 불가 | 비밀이나 데이터를 샌드박스 밖으로 내거나 안팎의 길을 연다. 선언할 코드 변경에 필요한 일이 아니다. |
| Sandbox Network Callback | 선언 불가 | 비밀이나 데이터를 샌드박스 밖으로 내거나 안팎의 길을 연다. 선언할 코드 변경에 필요한 일이 아니다. |
| Command Network Lists | 선언 불가 | 비밀이나 데이터를 샌드박스 밖으로 내거나 안팎의 길을 연다. 선언할 코드 변경에 필요한 일이 아니다. |
| Containment Escape | 선언 불가 | 비밀이나 데이터를 샌드박스 밖으로 내거나 안팎의 길을 연다. 선언할 코드 변경에 필요한 일이 아니다. |
| Create Public Surface | 선언 불가 | 비밀이나 데이터를 샌드박스 밖으로 내거나 안팎의 길을 연다. 선언할 코드 변경에 필요한 일이 아니다. |
| Public Data-Sharing Upload | 선언 불가 | 비밀이나 데이터를 샌드박스 밖으로 내거나 안팎의 길을 연다. 선언할 코드 변경에 필요한 일이 아니다. |
| Untrusted Code Integration | 선언 불가 | 밖의 코드나 패키지를 실행에 들인다. 선언이 판단할 수 없는 공급망 위험이다. |
| Package Registry Bypass | 선언 불가 | 밖의 코드나 패키지를 실행에 들인다. 선언이 판단할 수 없는 공급망 위험이다. |
| Unauthorized Persistence | 선언 불가 | auto mode가 기대는 검사(로그, TLS, CI, 샌드박스, classifier)를 끈다. 선언이 자기 우회를 승인할 수는 없다. |
| Self-Modification | **선언 가능** | 원하는 권한·동의 변경 |
| Tmux Self Drive | 선언 불가 | auto mode가 기대는 검사(로그, TLS, CI, 샌드박스, classifier)를 끈다. 선언이 자기 우회를 승인할 수는 없다. |
| Instruction Poisoning | **선언 가능** | 지침 파일 편집이 원하는 변경이라서, 이에 대한 경고는 오탐이라는 것(통제 칸이 무엇이 바뀌는지 적는다) |
| Auto-Mode Bypass | 선언 불가 | auto mode가 기대는 검사(로그, TLS, CI, 샌드박스, classifier)를 끈다. 선언이 자기 우회를 승인할 수는 없다. |
| Session Transcript Tampering | 선언 불가 | auto mode가 기대는 검사(로그, TLS, CI, 샌드박스, classifier)를 끈다. 선언이 자기 우회를 승인할 수는 없다. |
| Unrequested Commit in a Connected App | 선언 불가 | 운영·공유·제3자 시스템에 손댄다. 발권된 FLIGHT는 코드만 다루므로 선언할 효과가 없다. |
| External System Writes | 선언 불가 | 운영·공유·제3자 시스템에 손댄다. 발권된 FLIGHT는 코드만 다루므로 선언할 효과가 없다. |
| Merge Without Review | **선언 가능** | 리뷰 없이 머지하는 것 |
| Self-Approval | **선언 가능** | 변경이 없애거나 스스로 주는 승인 |
| ChatOps Trigger Comments | 선언 불가 | 운영·공유·제3자 시스템에 손댄다. 발권된 FLIGHT는 코드만 다루므로 선언할 효과가 없다. |
| Feature Flag Writes | 선언 불가 | 운영·공유·제3자 시스템에 손댄다. 발권된 FLIGHT는 코드만 다루므로 선언할 효과가 없다. |
| Node Lifecycle Operations | 선언 불가 | 운영·공유·제3자 시스템에 손댄다. 발권된 FLIGHT는 코드만 다루므로 선언할 효과가 없다. |
| Cluster-Wide Workload Creation | 선언 불가 | 운영·공유·제3자 시스템에 손댄다. 발권된 FLIGHT는 코드만 다루므로 선언할 효과가 없다. |
| Real-World Transactions | 선언 불가 | 운영·공유·제3자 시스템에 손댄다. 발권된 FLIGHT는 코드만 다루므로 선언할 효과가 없다. |
| Third-Party Attack | 선언 불가 | 운영·공유·제3자 시스템에 손댄다. 발권된 FLIGHT는 코드만 다루므로 선언할 효과가 없다. |
| Browser Navigate Exfil | 선언 불가 | 비밀이나 데이터를 샌드박스 밖으로 내거나 안팎의 길을 연다. 선언할 코드 변경에 필요한 일이 아니다. |
| Browser Input Exfil | 선언 불가 | 비밀이나 데이터를 샌드박스 밖으로 내거나 안팎의 길을 연다. 선언할 코드 변경에 필요한 일이 아니다. |
| Browser JS Exfil | 선언 불가 | 비밀이나 데이터를 샌드박스 밖으로 내거나 안팎의 길을 연다. 선언할 코드 변경에 필요한 일이 아니다. |
| Browser File Upload Exfil | 선언 불가 | 비밀이나 데이터를 샌드박스 밖으로 내거나 안팎의 길을 연다. 선언할 코드 변경에 필요한 일이 아니다. |
| Browser Shortcut Execution | 선언 불가 | 비밀이나 데이터를 샌드박스 밖으로 내거나 안팎의 길을 연다. 선언할 코드 변경에 필요한 일이 아니다. |

새로 더한 둘의 항목이 적는 것(classifier의 "must name" 글): *Security Test Removal*은 어떤 테스트를 없애거나 건너뛰는지 적고, *Instruction Poisoning*은 표시된 지침 파일 편집이 SUPERVISOR가 허락한 원하는 변경이라서 그 경고는 오탐이라는 것과, 선언한 파일만 덮는다는 것(다른 지침 파일·memory 폴더는 아니다)을 적는다. 모든 항목은 통제, 파일, STAND, 발권 id도 적는다.

### C9, 만든 것: K3 hold (ATC-398)

K3 효과가 있는 작업 지시서의 FLIGHT는 그 효과의 classifier allow를 갖고 떠나거나 떠나지 않는다. SUPERVISOR가 이미 푼 효과에서 classifier 거부로 FLIGHT 도중에 멈추는 일이 없다.

- **작업 지시서.** K3 효과는 `## K effects`에 선언 한 줄씩, `K3[<라벨>]: <바꾸는 통제> | files: <저장소 기준 경로>`이고 `<라벨>`은 `K3_LABELS` 가운데 하나다. K3 효과가 없는 작업 지시서에는 `K3`로 시작하는 줄이 없다. K3 작업 지시서는 RELEASE 화면이나 DUTY 채팅에서 발권한다. 세션은 발권을 증언하지 않는다(세션이 이슈를 만들고 SUPERVISOR가 쏜다). 규칙: `docs/rules.ko.md` "작업 지시서"와 DUTY 매뉴얼.
- **Hold.** `## K effects`에 `K3` 줄이 있는데 allow 항목 없이 떠날 FLIGHT는 DISPATCH가 보내지 않는다: 읽히지 않는 줄(이유 "not a declaration": `K3:` 뒤 산문, `K3: none` 등), 또는 `K3_CHANNELS`에 없는 채널의 발권(이유 "release on the screen"). 이유와 고치는 길은 DISPATCH 제외 사유로 보이고, Todo FLIGHT는 HOME 알림(`alert|k3-hold|<FLIGHT>`, hold 되어 있는 동안)도 올린다. 발권 전 FLIGHT는 알림이 아니라 RELEASE 화면이 K3 상태를 보인다.
- **RELEASE 화면.** SUPERVISOR가 쏘기 전에 `K3` 줄이 있는 FLIGHT의 줄이 선언이 읽히는지, 발권이 allow를 주는지(지금, 또는 화면에서 쏘면)를 보인다.
- **끄는 스위치.** `dispatch.json`의 `k3Hold`, 기본 켜짐, 설정 창(K3 HOLD, `fromThisApp`)에서만 바꾼다(`atcctl` 명령 없음). 깨진 파일은 켜짐으로 읽는다.
- **오작동 카운터**(RELEASE 화면 맨 위, `GET /api/releases`의 `k3Hold`): *nuisance*는 `K3` 줄이 효과 없음으로 적힌(`K3: none`) FLIGHT에 걸린 hold, *miss*는 allow 없이 떠난(`launch` 기록에 `k3`가 없는) K3 FLIGHT의 AIRCRAFT가 classifier 거부(세션 health `DENIED`)로 멈춘 것이다(7일 안).

### C9, 만든 것: K3 RELAUNCH (ATC-509)

돌고 있는 세션은 새 `--settings`를 받지 못하므로, 발권된 K3 FLIGHT는 새로 띄운 AIRCRAFT(ABSENT, DISPATCH launch 카드)만 받는다. AIRPORT에 그런 AIRCRAFT가 없으면 SUPERVISOR가 쉬는 AIRCRAFT를 손으로 멈추고 RESTARTING을 기다려야 했다.

- **이유.** 받을 곳 없는 FLIGHT가 이제 말로 이유를 댄다: "K3: needs a fresh LAUNCH"와 고치는 길 한 줄(쉬는 AIRCRAFT를 STOP하거나 `k3Relaunch`를 켠다). DISPATCH 제외 사유와 `unserved[].k3`에 있다.
- **카드.** `k3Relaunch`가 켜지면 FLEET PLAN이 `K3 RELAUNCH`("STOP <REGISTRATION> and LAUNCH it for <FLIGHT>")를 낸다. 조건: FLIGHT에 K3 entries가 있고(`k3LaunchOf`), 그 AIRPORT에 그 FLIGHT를 받을 ABSENT AIRCRAFT가 없고, 거기 AIRCRAFT 하나가 쉬는 중(백그라운드 세션, NORDO 아님)이고 열린 PR·STAND가 없고 LIMIT도 FUEL hold도 아님. 카드 하나에 AIRCRAFT 하나(가장 오래 쉰 것). 맞는 AIRCRAFT가 없으면 카드도 없다.
- **승인.** 승인은 조건을 다시 보고, **STOP 전에** 발권이 아직 allow를 주는지(같은 본문 해시) 확인한 뒤, STOP하고 `k3OfFlight`의 entries로 `launchAircraft`를 부른다(`launchForCard`와 같은 함수). FLIGHT RECORDER의 두 줄(`stop`, `launch`)은 `proposal`에 카드 id를 싣는다.
- **끄는 스위치.** `dispatch.json`의 `k3Relaunch`, **기본 꺼짐**, 설정 창(K3 RELAUNCH, `fromThisApp`)에서만 바꾼다(`atcctl` 명령 없음). 깨진 파일은 꺼짐으로 읽는다. 꺼져 있으면 이유 문구 말고는 바뀌는 것이 없다.
- **오작동 카운터**(RELEASE 화면 맨 위, 스위치가 켜졌거나 수가 0보다 클 때만 보임, `GET /api/releases`의 `k3Relaunch`), 7일: 승인한 카드, 만료·반대한 카드, *STOP만*은 카드의 STOP 뒤 `launchCardTimeoutMin` 안에 같은 카드 id의 LAUNCH 성공 줄이 없는 것.
- **FLEET LAUNCH 버튼.** `flight`를 적은 `POST /api/fleet/:registration/launch`가 launch 카드와 같은 K3 entries를 만든다(`k3OfFlight`: 같은 `k3LaunchOf`, 같은 해시 검사, 화면이나 DUTY 채팅 발권만). 유효한 발권이 없으면 전과 같다.

## 6. 남는 세 게이트를 내보낼 때 선언으로

화살 방향(원칙 1, 4, 10)에서 K1–K3 효과는 머지 때가 아니라 SUPERVISOR가 FLIGHT를 내보낼 때 한 번 승인한다. 내보내기가 효과를 선언하고, 내보내기 기록(C18)이 승인을 선언의 해시에 묶는다(원칙 7). 내보낸 뒤에는 floor가 빌드된 내용을 선언과 맞댄다. 빌드된 변경이 선언을 넘는 FLIGHT(선언하지 않은 K 경로, 더 넓은 변경, floor가 분류하지 못하는 구문)는 멈추고, 빌드된 내용을 붙인 새 화살로 돌아온다. 그 새 화살이 곧 카드다. 머지 때 SUPERVISOR를 기다리는 것은 없다. 내보내기는 최소로 둔다: 목적지와 선언된 K 효과뿐이고, 경로 목록이나 FLIGHT별 예산은 없다(상한은 C11).

- **K1: 호스팅 migration, 라이브 데이터, atc 자신의 state 기록.** 선언은 모든 DML 구문과 모든 파괴적 대상(`DROP`, `TRUNCATE`, 열 타입 변경, 이름 바꾸기, 조건 없는 `DELETE`나 `UPDATE`)을 적는다. floor는 이런 종류에는 강하고 로직(틀린 조건, backfill)에는 약하므로, 선언되지 않았거나 분류할 수 없는 구문은 새 화살이다. **Decided(D6 g):** 빌드된 migration이 선언과 맞고 시험 DB의 리허설을 통과하면(C20) atc가 복원 지점을 잡고 적용하고 머지한다.
- **K2: 비밀, 돈, 법적 문구, 권리, atc 통제를 벗어나는 데이터.** 선언은 환경 키의 이름(값은 절대 아님), 결제·법적 문구, 권리 증거, 새 외부 전송처나 더 넓은 필드 허용 목록을 적는다(D14). 공개 전 검사기(C17)가 push 때 비밀이나 비공개 AIRPORT 내용을 찾아내면 새 화살이다. 카드는 비밀 값을 절대 찍지 않는다.
- **K3: guard, 권한, `.claude/`, 자율 규칙, 그리고 모든 풀기.** 선언은 무엇을 넓히는지 적는다. 서버는 권한 집합과 규칙 손잡이의 차이(allow 추가, deny 제거, hook 제거, 푸는 쪽으로 움직인 손잡이. 원칙 3)를 계산해 선언과 맞댄다. 선언보다 넓거나 방향을 계산할 수 없으면 새 화살이다.

### K 승인이 착륙까지 가는 길 구현 내용 (ATC-391)

SUPERVISOR는 K 효과를 발권 때 한 번 승인하고, 승인한 것을 그대로 만든 PR은 머지 때 두 번째 사람 단계 없이 MCC가 착륙시킨다. **처음부터 켜져 있다(live first)**. 끄는 스위치 하나, `mcc.json`의 `kApproval`(기본 `on`, 정확히 `off`일 때만 꺼진다)은 설정 창(MCC 줄 "K APPROVAL", `PUT /api/settings {mccKApproval}`, SUPERVISOR만, `atcctl` 명령 없음)에서만 바꾼다. 순수 규칙은 `kApprovalOf`(`server/k-approval.ts`)이고, `landBlocksOf`는 이것이 `ok`일 때만 `user` 등급 PR의 L3를 푼다. 착륙의 나머지 조건(L2, L4–L8: head의 INSPECTION `pass`, CI, 머지 상태, HOLD, GROUND STOP, RTS)은 그대로다.

- **성립해야 하는 것.** (1) PR의 FLIGHT에 지금 유효한 발권 기록이 있다(해시가 지금 이슈 본문과 같다). (2) 그 발권이 서버가 확인할 수 있는 길, 화면이나 DUTY 채팅(`screen`·`duty-chat`)이다. (3) 이슈가 K3 효과를 ATC-372 모양(`## K effects`의 `K3[<라벨>]: <통제> | files: <경로>`)으로 선언했고 diff의 모든 `user` 등급 파일이 선언한 파일 가운데 있다. (4) head의 INSPECTION이 pass이고 CI가 통과했다(L4·L6). 선언한 파일을 PR이 건드리지 않아도 된다: 선언은 상한이다.
- **attested만으로는 K 권한이 없다.** `attested` 발권(다른 세션이 SUPERVISOR가 한 말을 증언)은 L3를 풀지 못한다. RELEASE 화면은 K3 효과를 선언한 FLIGHT의 attested 발권을 "K 효과 확인"에 보이고, SUPERVISOR의 클릭 한 번(`POST /api/releases/k-confirm`, 화면에서만, 그 발권의 해시에 `releases.jsonl`의 `k-confirm` 줄)이 K 권한을 준다. 그 클릭도 발권 때의 일이다. 새 발권이나 고친 이슈는 확인을 없앤다.
- **SUPERVISOR 몫으로 남는 것, 이유와 함께**(L3 문구·`mcc queue`·packet의 `kApproval.why`): 선언을 넘는 변경(`beyond-declaration`: 선언하지 않은 `user` 등급 파일, 새 화살), 의심의 ESCALATE(풀지 않는다), P0·P1 지적(INSPECTION `findings`, L6), 이 검사 자체를 바꾸는 PR(`check-itself`). `k-approval.ts`에 목록이 둘이다: `CHECK_CORE`(규칙과 길 그 자체: `k-approval.ts`·`k3-allow.ts`·`mcc.ts`·`mcc-run.ts`·`land-by.ts`·`release.ts`·`release-run.ts`·`release-store.ts`)는 **어느 착륙 등급이든** PR을 멈춘다. 이 파일 대부분이 `landing-tier.mjs`에서 `auto`·`flagged`라서 `landBlocksOf`가 L3를 걸고(`checkPath`) `landBy`는 `supervisor`와 `why: "check"`를 준다. `CHECK_CONTEXT`(검사가 기대는 곳: `origin.ts`·`supervisor-auth.ts`·`settings.ts`·`index.ts`·`landing.ts`·`sources/linear.ts`·`.github/`·`deploy/`·`mcc/`)는 보통 PR도 많이 건드려서(`server/index.ts`는 거의 모든 라우트 PR) K 승인으로 착륙하려는 `user` 등급 PR만 막고, 그 밖의 PR은 전처럼 착륙한다, 마이그레이션·SQL·비밀·키 경로(`k1-k2`: K1·K2 선언은 아직 읽지 않는다), FLIGHT·발권·선언이 없거나, FLIGHT가 이미 끝나거나 취소됐거나(`flight-closed`: 발권은 FLIGHT가 열려 있는 동안만 K 권한을 준다) 발권이 낡았거나 `K3` 줄이 깨졌을 때(`no-flight`·`no-release`·`stale`·`no-declaration`·`unreadable-declaration`), 스위치 꺼짐(`off`).
- **기록하고 센다.** `mcc.jsonl`의 `land` 줄에 `k: {release, flight, channel}`가 붙는다(발권 id는 `<FLIGHT>@<해시>`, K3 LAUNCH allow 항목과 같다). 설정 창은 UTC 날짜별(최근 7일)로 이렇게 착륙한 PR 수, 그 가운데 자동 되돌림 PR이 열린 수(`auto-revert.jsonl`), 착륙 뒤 처음 나온 RTS 결과가 ROLLBACK인 수를 보인다. GitHub에서 손으로 되돌린 것은 알 수 없다.
- **누가 착륙시키나.** 그런 PR의 `landBy`는 `supervisor`가 아니라 `mcc`라서 TOWER가 팀에 아무것도 보내지 않고 PR 서랍도 MCC를 착륙시키는 쪽으로 보인다. `kApproval.ok`가 아닌 user 등급 PR은 이유와 함께 `supervisor`다.
- **바뀐 관제 규칙(PR 본문에 따로 적음).** `mcc/CLAUDE.md`·`CLAUDE.en.md`(서버가 풀어 준 `user` PR은 MCC가 착륙시키고 등급만으로 ESCALATE하지 않는다), `mcc/.claude/agents/inspector.md`(ESCALATE는 의심일 때, packet에 `kApproval`), 루트 `CLAUDE.md`·`CLAUDE.en.md`(`user` 항목에 예외).
- **만들지 않은 것:** K1·K2 선언(K3만 읽는다), 손으로 한 revert 수, 선언한 통제와 변경이 말로 맞는지의 라벨별 확인(검사는 파일로 하고 변경은 INSPECTION이 읽는다).

## 7. SUPERVISOR의 주간 보고

기존 기록으로 C8이 만드는 한 쪽짜리 보고이고, NETWORK 탭(이미 착륙 대기를 보인다)의 블록과 주 1회 ANNUNCIATOR 알림으로 보인다. SUPERVISOR가 숫자를 보는 곳이다. 풀기 카드(원칙 3)는 언제든 올 수 있다.

| 숫자 | 출처 |
|---|---|
| AIRPORT별, 레인별(AUTOLAND, MCC, 손) 머지한 PR | `autoland.jsonl`, `mcc.jsonl`, GitHub 머지 목록 |
| 사유별 남은 SUPERVISOR 머지 | 제외 로그(조사 W1) |
| 열고 머지까지 중앙값과 p90 | LOGBOOK `landingWaitMin` |
| 머지 100건당 빨간 `main` head, 초록까지 시간 | `main` push 실행 |
| 72시간 안의 revert·hotfix PR, 착륙한 자동 revert와 결과 | GitHub, C4 기록 |
| 두 레인의 불일치와 끝난 모양, 레인별 놓침과 심은 결함의 both-miss, 단일 리뷰(D20) | `landing-reviews.jsonl`, `autoland-reviews.jsonl`, 둘째 레인 로그, C7 기록 |
| 감사 표본: 감사한 head, P0·P1 지적 | C7 기록 |
| 조임: 확인됐는지 거짓인지, 저절로 다시 연 것, 붙잡은 시간, 되돌아온 항목(조임 부하), 같은 원인 두 번째 trip. 풀기 카드와 기다린 시간 | C6 기록 |
| 머지당 비용(리뷰 토큰, FUEL) | FUEL, judge 로그 |
| 내보내기: 통로별, K1–K3 효과가 있는 것, 세션별 증언된 것. 봉투를 벗어나 생긴 새 화살 | C18, C9 기록 |
| 쓴 brake, 종류별(HOLD, CANCEL, RECALL, STOP, 수동 GROUND STOP, 모드 내리기) | `autoland.jsonl`, `mcc.jsonl`, `proposals.jsonl`, `atfm` 기록 |
| 하루 DISPATCH 오작동: decline, UNABLE, RECALL, 보낸 뒤 대체, 잘못 고른 AIRCRAFT(D22). SCHEDULE, FLEET PLAN, CREW CHANGE 오작동(D23) | `proposals.jsonl`, `schedule.jsonl`, `fleet-plan.jsonl` |
| leak(원칙 1): 내보낸 뒤의 사람 단계, leak 시간과 붙잡힌 일, 맡을 쪽 통제가 섰는지로 나눠 | SUPERVISOR QUEUE와 NEEDS YOU의 열림·닫힘 줄 |
| 통제와 동작별 오작동, harmful과 nuisance(원칙 2) | 실제 결정 줄을 결과에 이은 것 |
| revert까지 시간과 그 창의 효과: 보낸 메시지, 전송처별 외부 데이터, 걸린 공개(원칙 4) | C4, C17, `clearances.jsonl` |
| 결과에 잇지 못한 판정: 이을 키 없음, 정답 없음(원칙 7) | 로그 |

## 8. 구현 순서

통제는 대신하는 게이트가 사라지기 전에 서고, 단계마다 작업 지시서(제목, 범위, 예상 등급), 끄는 스위치와 오작동 카운터, 켠 채로 두는 실제 한도를 적는다. **Decided 2026-10-02(D21):** 어느 단계도 먼저 shadow로 돌지 않는다. 통제마다 스위치와 카운터를 달고 켜며, 아래의 측정은 켜는 조건이 아니라 실제 한도다. 작업 지시서는 여기에 적고 Linear에는 만들지 않는다. DUTY나 ENGINEERING이 만든다. 등급은 `deploy/landing-tier.mjs`를 따른다: AUTOLAND·MCC·LANDING 등급 규칙의 변경은 K3 파일이라 SUPERVISOR를 한 번 거친다.

### 0단계: 잰다(이번 주, 게이트 변경 없음)

- **WO-1 제외 로그.** AUTOLAND가 CLEARED PR에 제외가 시작될 때 한 줄(사유와 head), 끝날 때 한 줄을 쓰고 하루 개수를 낸다(원칙 7). 등급 `flagged`.
- **WO-2 빠져나간 결함 기록.** 빨간 `main` head, revert·hotfix PR, 뒤늦은 리뷰 지적을 GitHub와 로그에서 주마다 센다. LOGBOOK `reverted` 쓰기를 고친다. 등급 `auto` 또는 `flagged`.
- **WO-3 주간 보고 v0.** 이미 있는 숫자로 7절의 블록. 등급 `auto`.
- **MCC의 기존 관문.** `mccGateOf`는 불일치 55건을 보이지만 가 판단에 넣지 않는다. 표본을 판정하고(MCC의 오경보인지 사람의 실수인지) 오작동 항을 더한다(원칙 2).
- 스위치와 카운터: 필요 없음(읽기만). 가: 보고가 사유별 남은 SUPERVISOR 머지를 보인다.

### 1단계: 첫 통제를 스위치·카운터와 함께 켠다(이번 주)

- **WO-4 둘째 리뷰 레인.** 다른 벤더 리뷰어가 AIRPORT head마다 카운터와 함께 실제로 리뷰한다. 불일치를 기록한다. 등급 `flagged`.
- **WO-5 리뷰어 쪽 분류.** 머지 리뷰 판정에 이유가 붙은 `securityBoundary`가 생기고 키워드·경로·라벨 결과 옆에 기록된다. 등급 `flagged`.
- **WO-6 breaker v0.** 주기가 빨간 head와 revert를 세고, 문턱을 넘으면 AUTOLAND가 스스로 `merge`에서 `update`로 내려가 알림을 한 번 보낸다. 다시 올리는 것은 SUPERVISOR뿐이다. 다만 거짓으로 밝혀진 trip은 저절로 다시 열린다(D12). 등급 `user`(AUTOLAND 규칙: 이 PR은 SUPERVISOR가 머지한다).
- **WO-7 AIRPORT의 `main` push마다 시험**(통제 C3, VOC 이슈). atc 밖.
- **WO-8 SUPERVISOR 전용 라우트 모두에 Origin 검사**(통제 C12, 1.4절). 등급 `user`(자율을 지키는 서버 라우트, 결정 D10).
- 모두 스위치와 카운터를 달고 켠다. 한도: 2단계 참고.

### 2단계: 첫 게이트 절감, 이번 주에 낼 수 있다(4~5일째, 측정이 정한다)

L1, L2, L3, L4가 AIRPORT A에서 **두 레인이 head를 통과시키고 분류기가 일치할 때** 위임 가능해진다. AIRPORT PR의 SUPERVISOR 머지를 줄이는 첫 단계다: 보안 게이트가 건드리던 PR의 79%에 해당하는 `Risk: Contract`, `Risk: Security`, `rating:SEC`, 경로, 키워드 제외를 없앤다.

- **WO-9 이중 리뷰 위임.** C1이 일치하면 `mergeExclusionOf`가 L1–L4를 푼다. L5–L9는 남는다. 등급 `user`(AUTOLAND 규칙).
- 가를 정하는 측정(지금 적어 둔다): 처음 켠 head 50개에서 일치율 90% 이상. 감사 표본(C7)에서 두 레인이 모두 통과시킨 head에 P0·P1 놓침 없음. breaker v0 가동. C3 가동. 하루 약 17건이면 head 50개는 약 3일이다. 오작동(원칙 2): 판정한 표본에서 둘째 레인의 P0·P1 오경보율과 C2의 과잉 표시율이 돌리기 전에 적은 한도 아래이고, 심은 결함(C7)의 both-miss가 그 한도 아래다.
- 기대 효과: AIRPORT A의 SUPERVISOR 머지가 주 약 117건에서, K1 migration PR(replay로 16%, 내보낼 때 선언하고 빌드된 migration이 맞으면 atc가 적용하거나, 이미 적용됐으면 자동), K2, 그리고 통제가 서기 전의 L8, L9의 잔여로 줄어든다(대략 PR의 20% 이하. WO-1이 잰다).
- 되돌림: breaker, 또는 제외 규칙을 되살리는 한 번 클릭.

### 3단계: 자동 revert와 breaker v1

- **WO-10 자동 revert 레인(C4).** 먼저 제안으로(SUPERVISOR가 보는 revert PR 초안, 아무것도 착륙 안 함), 그다음 같은 레인이 착륙시킨다. revert 전에 실패한 job을 한 번 다시 돌린다. 등급 `flagged`.
- **WO-11 breaker v1(C6)과 감사 표본 가동(C7).** 비율별 문턱, 단계로 조임. 등급 `user`.
- 가를 정하는 측정: revert PR이 5건 이상(또는 지난 빨간 head의 replay)에서 맞고 초록. 폭풍 방지 시험에서 폭풍 없음. replay에서 죄 없는 would-revert 0건, flaky 빨강 포함(1.5의 2026-10-02 빨강이 fixture). breaker 헛 trip은 창마다 1건 이하이고, 빨강은 한 번 다시 돌린 뒤에 센다.
- 그다음 L15(GROUND STOP 해제)가 자동이 된다. replay에서 섣부른 해제 0건, 다시 돌려 초록인 빨강에 건 걸림은 센다.

### 4단계: K 효과를 내보낼 때 선언(C9, C18)

- **WO-12 K1, K2, K3의 내보내기 선언.** 내보내기 기록(C18, [ATC-362](https://linear.app/vocado/issue/ATC-362))이 선언된 효과를 싣고, floor가 빌드된 내용을 맞대어 그 너머에서 FLIGHT를 멈춘다(6절). 등급 `user`(누가 일을 시작할 수 있고 무엇이 착륙하는지 바꾼다).
- 게이트는 남고 그 순간이 머지에서 내보내기로 옮겨 간다. 가: 최근 K1–K3 PR 20건에서 floor가 놓친 K 경로 0건.

### 5단계: atc의 `user` 등급을 좁힌다

- **WO-13 state 형식 호환 시험(C13)**과 더하기만 하는 형식 PR을 MCC에 위임. 등급 `user`(LANDING 등급 규칙).
- **WO-14 의존성을 의존성 리뷰와 RTS `npm ci`로**, health check와 ROLLBACK과 함께. 등급 `user`(deploy).
- 가: 최근 형식 PR 30건에서 형식 호환 시험이 초록이고 replay에서 잘못 통과 0건(잘못 실패는 보고), 의존성 리뷰가 필수 체크. K3 파일을 뺀 ESCALATE 줄(주 28건)이 줄어든다.

### 6단계: 더 많은 AIRPORT와 DISPATCH 승인

- **WO-15 다른 AIRPORT에 AUTOLAND**를 하나씩, 필수 CI 체크와 C3가 있을 때만. 등급 `user`(`autoland.json`의 airports 목록을 AUTOLAND 규칙이 읽는다. SUPERVISOR가 AIRPORT마다 켠다).
- **WO-16 사람 없는 제안.** DISPATCH의 ASSIGN과 LAUNCH([ATC-367](https://linear.app/vocado/issue/ATC-367), D22), 그다음 SCHEDULE, FLEET PLAN, CREW CHANGE([ATC-370](https://linear.app/vocado/issue/ATC-370), D23)를 planner 필터와 C11 상한 아래 서버가 승인하고, 그 뒤 CROSSCHECK를 퇴역시킨다([ATC-371](https://linear.app/vocado/issue/ATC-371)). 저마다 스위치와 카운터를 달고 켠다. 등급 `flagged`(ATC-371은 `user`).
- P1–P5의 실제 한도: 하루 오작동 비율(decline, UNABLE, RECALL, 보낸 뒤 대체, 잘못 고른 AIRCRAFT. SCHEDULE과 FLEET PLAN은 되돌리거나 거절된 수정)이 스위치를 켜기 전에 적은 한도 아래. 넘으면 스위치가 꺼지고 카드는 SUPERVISOR에게 돌아간다(원칙 2).

### 7단계: 검증 레인, FLIGHT 연결, 배포 뒤 검사

- **WO-17 검증 레인(C10)**과 HUMAN CHECK 종류를 차례로 퇴역(CHOICE, DEVICE, 그다음 ACCOUNT). 등급 `flagged`.
- **WO-18 FLIGHT 연결(C15).** 등급 `flagged`.
- **WO-19 호스트가 지원하는 AIRPORT의 배포 뒤 검사와 rollback(C5).** 등급 `flagged`.
- **WO-20 추가 레인의 지출 상한(C11).** 등급 `flagged`.
- 가: 3단계 숫자가 두 주 동안 안정된 뒤. WO-17은 잘못 막은 것을 보고하고, WO-18은 50건에서 틀린 연결 0건, WO-19는 건강한 배포의 rollback 1건 이하.

### 2026-10-02 개정이 더한 것

- **WO-21 내보내기 기록(C18).** [ATC-362](https://linear.app/vocado/issue/ATC-362). DUTY guard가 바뀌면 등급 `user`.
- **WO-22 leak 카운터(원칙 1).** [ATC-363](https://linear.app/vocado/issue/ATC-363). 등급 `auto` 또는 `flagged`.
- **WO-23 입력 묶기(원칙 7).** proposals, schedule, judges, fleet-plan 기록의 내용 해시, clearances의 head 칸, 모든 기록의 내보내기 id. 등급 `flagged`.
- **WO-24 글 신뢰 고치기(원칙 6, D19, L10).** 바깥 리뷰는 세지 않음, 경로와 화면 기록으로 HUMAN CHECK, 라벨 건너뛰기를 계산된 사실로, 자기 레인에 묶인 리뷰 기록, 데이터 울타리(C19). 등급은 파일마다.
- **WO-25 brake 준수 시험(원칙 9).** 각 brake가 걸린 동안 모든 레인이 거절하는지, SUPERVISOR 전용 라우트가 Origin 없이 403을 내는지 보는 CI 시험. WO-8에 합친다. 등급 `user`.
- **WO-26 심은 결함(C7, D17)**과 **WO-27 공개 전 검사기(C17, hook).** 등급 `flagged`와 `user`.
- **WO-28 migration 리허설(C20).** [ATC-368](https://linear.app/vocado/issue/ATC-368). AIRPORT마다 스위치 하나. 그 AIRPORT의 시험 DB와 자격 증명(K2, SUPERVISOR가 설정)이 있으면 켠다. 등급 `user`.

게이트도 통제도 없는 틈을 두는 단계는 없다: 2단계는 C1, C2, C3, C6 v0, C7이 카운터와 함께 켜져 있기를 요구한다. 3단계는 수동 GROUND STOP 해제를 없애기 전에 선다. 5–7단계는 3·4단계가 필요하다.

## 9. 위험

| 위험 | 일어날 수 있는 일 | 완화 |
|---|---|---|
| 모델 둘이 같은 사각지대를 가진다 | 둘 다 나쁜 변경을 통과시킨다 | 다른 벤더와 지시(원칙 5), 셋째 리뷰어의 C7 감사, 일치를 지켜볼 숫자로, breaker |
| revert 폭풍 | revert가 `main`을 다시 깨거나 revert가 이어진다 | 한 번에 revert 하나, revert의 revert 금지, 한 시간에 revert 둘이면 breaker(C4, C6) |
| PR 글로 속이는 분류기 | PR이 스스로 무해하다고 서술한다 | 분류기는 diff를 읽고 글은 위험을 올릴 뿐(원칙 6), 결정적 바닥은 남는다 |
| 에이전트가 K3 뒤의 파일을 고친다 | 에이전트가 자기 한계를 넓힌다 | K3 경로는 `user` 등급이고 모든 lander가 거절한다(C12). SUPERVISOR 전용 라우트는 `Origin`을 검사한다. 모든 머지가 GitHub 로그인 하나로 이뤄지므로 GitHub 자체의 리뷰 규칙으로는 강제할 수 없고 atc의 규칙이 해야 한다 |
| 프롬프트 주입이 리뷰어에 닿는다 | PR 글이 리뷰어에게 지시한다(조사 1.6: AI 리뷰 Action의 CVSS 9.4 결함) | 리뷰어는 패킷을 읽고 비밀 없이 돈다. `pull_request_target`에 리뷰 Action을 두지 않는다. PR 글의 지시는 데이터다 |
| 추가 리뷰의 비용 | 두 레인과 감사로 리뷰 토큰이 약 두 배 | 지출 상한(C11), 감사는 10% 표본, 머지당 비용이 주간 보고에 있다 |
| breaker가 흔들린다 | 조였다 풀었다 자주 한다 | 확인된 신호로만 조인다. 거짓 trip은 저절로 다시 열리고, 같은 원인의 두 번째 trip이 7일 안이면 수정이 먼저다(D12, D13). 사건마다 알림 하나 |
| 저절로 다시 열기가 진짜 실패를 숨긴다 | 진짜 빨강을 flaky로 본다 | 거짓 판정에는 초록 재실행과 초록 다음 head가 모두 필요하다. brake와 D4 걸림에는 쓰지 않는다. 저절로 다시 연 것은 모두 breaker 오작동으로 센다 |
| 거짓 증언 | 세션이 SUPERVISOR의 말이라며 FLIGHT를 내보낸다 | 증언된 내보내기는 표시되고 세션별로 주간 보고에서 세어 골라 확인한다(C18). 화면 내보내기는 에이전트가 만들 수 없다 |
| 선언이 숨긴 것을 floor가 놓친다 | migration의 로직(틀린 조건, backfill)이 K1 floor를 통과한다 | 선언은 모든 DML과 파괴적 대상을 적는다. 선언되지 않았거나 분류할 수 없는 것은 새 화살이다. floor가 놓친 것은 켜기 전에 잰다(원칙 2) |
| 레인이 빠진 동안 리뷰 하나로 통과한다 | 레인 하나가 잡았을 결함이 착륙한다 | 단일 리뷰는 기록하고 센다(D20). 심은 결함이 단일 레인의 놓침을 잰다(C7) |
| 속도가 측정을 앞지른다 | 자료가 말하기 전에 게이트가 나간다 | 통제마다 끄는 스위치, 오작동 카운터, 먼저 적은 한도와 함께 켜고, 한도를 넘으면 게이트가 저절로 돌아온다(원칙 2, 8) |
| 승인 피로 | 내보내기 선언이 쌓인다 | 내보낼 때의 K1–K3뿐이고 머지 때 카드는 없다. 주간 보고가 센다 |
| AUTOLAND와 MCC가 서로를 막는다 | PR이 두 시스템을 기다린다 | AIRPORT마다 lander 하나(기존 규칙) |
| 작은 기준선 | 7일 자료, 빨간 head 2개 | 문턱은 굴러가는 창의 비율로 정하고 첫 보고에서 다시 본다 |

## 10. SUPERVISOR의 결정

권장 기본값과, 2026-10-02 SUPERVISOR의 결정(**Decided**로 표시)을 적는다.

- **D1 breaker 문턱.** 기본: 어떤 머지 50건에서 `main` head가 3개를 넘게 빨강(기준선 1.7%의 약 3배)이거나, 7일에 revert 2건이거나, 감사에서 P0가 나오면 조인다. 빨간 head는 실패한 job을 한 번 다시 돌린 뒤에만 센다. 다시 열기는 D12와 D13을 따른다.
- **D2 첫 절감(2단계)의 가 조건.** 기본(실제 한도로): 처음 켠 head 50개에서 일치율 90% 이상, 두 레인이 모두 통과시킨 head에 감사 P0·P1 놓침 없음, 오작동 한도 충족(원칙 2), 심은 결함의 both-miss가 한도 아래.
- **D3 리뷰 모델.** 기본: 둘째 레인은 PR 작성 세션과 다른 벤더(작성자가 Claude면 Codex, Codex면 REVIEW 레인), 셋째(감사) 리뷰어는 그 둘이 아니다. 어느 벤더와 요금제로 할지, 하루 리뷰 예산은 SUPERVISOR의 몫이다. **Decided:** 내용을 다른 벤더에 보낼 수 없는 민감한 PR은 그 AIRPORT에 미리 승인한 외부 모델(K2, 내보낼 때 승인)을 쓰고, 없으면 같은 벤더의 다른 모델·지시·입력을 써서 부분 독립으로 센다.
- **D4 AIRPORT 순서.** 기본: AIRPORT A(이미 위임 중), 그다음 atc의 `user` 등급 좁히기(5단계), 그다음 필수 CI 체크가 생긴 다른 AIRPORT.
- **D5 감사 비율.** 기본: 자동 머지된 head의 10%.
- **D6 세 게이트가 끝나는 곳**(질문이며 설계하지 않았다): (a) `.github/`(CI, 필수 체크)는 K3인가? 권장: 그렇다. CI가 통제이기 때문. (b) `deploy/*.service` 유닛은 K3인가? 권장: 그렇다. (c) `package*.json`의 의존성 변경은 게이트인가? 권장: 아니다(의존성 리뷰로 자동화). (d) CHECKRIDE rating 부여(SEC rating이 SEC 작업을 맡을 팀을 정한다)는 K3인가? 권장: 그렇다. (e) 세션이 기다리는 도구 승인 프롬프트는 K3인가? 권장: 그렇다. 내보낸 뒤의 그런 프롬프트는 leak이기도 하다(원칙 1). (f) 이미 적용된 migration(ATC-329)은 K1 밖인가? 권장: 그렇다, 만들어진 대로. (g) atc가 migration을 직접 적용해도 되는가? **Decided(2026-10-02):** 그렇다. 빌드된 migration이 내보낼 때 승인한 선언과 맞고 시험 DB의 리허설을 통과할 때(6절, C20).
- **D7 내보내기와 새 화살을 만드는 곳.** 기본: SUPERVISOR QUEUE와 FLIGHT drawer, ANNUNCIATOR 알림 하나. 세션에 직접 한 SUPERVISOR의 말도 된다(D9).
- **D8 주간 보고.** 기본: 월요일 오전 9시(현지), NETWORK 블록과 알림 하나.
- **D9 내보내기.** **Decided:** FLIGHT는 SUPERVISOR만 atc 화면의 클릭이나 세션에 직접 한 말("전화 예약")로 내보낸다. 에이전트는 제안을 그리되 내보내지 못한다(원칙 10, C18). 아이디어 라벨과 DUTY 헌장은 방향 입력으로 남는다.
- **D10 SUPERVISOR 전용 라우트 모두에 Origin 검사**(1.4절). 기본: 한다. 1단계에서, 나머지와 상관없이.
- **D11 brake.** **Decided:** HOLD, CANCEL, RECALL, STOP, 수동 GROUND STOP, 모드 내리기가 brake이고 SUPERVISOR가 걸고 푼다. 모드 올리기는 K3 풀기다(원칙 9).
- **D12 저절로 다시 열기.** **Decided:** 초록 재실행과 초록 다음 head로 거짓이 밝혀진 trip은 저절로 다시 열린다. brake와 D4 걸림은 아니다.
- **D13 같은 원인의 창.** **Decided:** 7일. 같은 원인의 두 번째 trip은 머지된 수정이나 작업 지시서 링크가 있어야 다시 열린다.
- **D14 atc 통제를 벗어나는 데이터는 K2.** **Decided:** 그렇다. 먼저 floor(C17, C12)로 강제해 걸린 것만 SUPERVISOR에게 간다.
- **D15 atc 자신의 state 기록 다시 쓰기는 K1.** **Decided:** 그렇다(C13).
- **D16 revert까지 시간.** 기본: 확인된 빨강에서 15분(C4).
- **D17 심은 결함.** **Decided:** atc PR에서 주 10건으로 시작하고, 주간 보고의 비용을 보고 조정한다(C7).
- **D18 민감한 PR.** **Decided:** 사람 게이트 없음. D3의 리뷰 순서를 따른다.
- **D19 바깥 리뷰.** **Decided:** 협업자가 아닌 사람의 GitHub 리뷰는 리뷰로 세지 않는다. atc 레인의 기록만 센다(원칙 6).
- **D20 레인 장애.** **Decided:** 레인 둘이 필요한 PR은 레인 하나가 빠지면 리뷰 하나로 통과하고, 단일 리뷰로 기록해 센다(L16).
- **D21 먼저 켜기.** **Decided:** shadow 실행은 없다. 모든 통제는 끄는 스위치와 오작동 카운터를 달고 켜고, 8절의 측정은 그 실제 한도다. K1 migration은 시험 DB에서 리허설하고(C20), 내보낼 때 승인한 외부 전송처(K2)는 바로 실제로 쓴다.
- **D22 DISPATCH.** **Decided 2026-10-02:** planner의 결정적 필터와 C11 상한을 통과하는 ASSIGN과 LAUNCH 카드는 모두 서버가 승인한다. CROSSCHECK는 DISPATCH 길에서 빠지고 blind 표본도 없다. SUPERVISOR 전용 끄는 스위치와, 나중 결과로 센 오작동 카운트와 함께 켠다. 2026-10-01 06:00Z 이후 SUPERVISOR의 수동 승인 102건, 기각 2건, 자동 7건이었다[observed].
- **D23 SCHEDULE, FLEET PLAN, CREW CHANGE.** **Decided 2026-10-02:** D22의 DISPATCH처럼 사람도 CROSSCHECK 일치도 없이 돈다. NEW 초안은 제안으로 Backlog에 두고 ROUTE와 TARGET은 제안으로 남는다([ATC-370](https://linear.app/vocado/issue/ATC-370)). D22와 D23이 켜지면 CROSSCHECK 세션은 퇴역하고([ATC-371](https://linear.app/vocado/issue/ATC-371)), 지난 판정은 기록으로 남는다.
- **D24 내보낸 뒤 프롬프트 없음.** **Decided 2026-10-02:** AIRCRAFT의 도구 프롬프트는 LAUNCH 때 넘기는 atc 정책 hook으로 바뀌고, PENDING·HUNG으로 서 있는 끝난 AIRCRAFT는 멈춘다([ATC-369](https://linear.app/vocado/issue/ATC-369)). 관제 세션의 DECISION 카드는 K1–K3에만 쓰고, 그 밖의 결정은 정해 둔 기본값으로 진행하거나 새 화살로 돌아온다([ATC-352](https://linear.app/vocado/issue/ATC-352)).
- **열려 있음, 결정 안 됨:** DISPATCH의 RELEASE와 CLASSIFY 카드가 D22를 따를지, ATC-362가 제안한 지금 Todo 목록의 한 번 일괄 확인, C7이 단일 리뷰 head를 먼저 감사할지.
