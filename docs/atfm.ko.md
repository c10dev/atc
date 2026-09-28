# 3단계 ATFM 설계

[English](atfm.md) · **한국어**

ATFM(air traffic flow management, 교통 흐름 관리)은 atc의 3단계다. 1–2단계에서 atc는 교통을 보고(TOWER), 일을 제안하고(DISPATCH), 티켓 변경 초안을 쓰고(OCC SCHEDULE), 두 번째 의견을 받았다(CROSSCHECK). 결정은 모두 SUPERVISOR가 했다. 3단계에서 atc는 두 가지를 더 한다.

- SUPERVISOR도 같은 결정을 내릴 것이 데이터로 보이는 좁은 경우에는 스스로 처리한다.
- 시스템이 붐비거나 고장 나면 교통을 늦춘다.

> 상태(2026-09-27): SUPERVISOR가 열린 질문 10개를 결정했다(맨 아래 "결정"). 8장의 1–5번이 구현됐다: 데이터 수집, GROUND STOP, 머지 슬롯, DISPATCH와 S3의 자동 대상 판정. 모두 그림자 운용이다(계산하고 보이고 기록만 한다. 실제로 움직이지 않는다). 6번은 스위치 뒤에 구현됐다: GROUND STOP 다섯 가지(main 깨짐, 실패 몰림, 혼잡, LOS, 수동)를 모두 `on`으로 켤 수 있고, 켜면 실제로 막는다. 실패 몰림·혼잡·LOS의 해제 규칙과 두 번째 trigger는 ATC-62(2026-09-28)에서 더했다. 7번은 스위치로 구현됐다: 머지 슬롯을 `on`으로 켤 수 있고(기본 `shadow`), 켜면 TOWER가 `in-slot` PR에만 LAND를 준다. 실제로 막을 수 있는 것은 GROUND STOP과 머지 슬롯뿐이고, 기본으로 켜진 스위치는 없다. 8번 RECALL도 구현됐다([dispatch.ko.md](dispatch.ko.md) "RECALL"). 자동 배정과 자동 S3는 구현되지 않았다. 구현된 것은 10장에 있다.

관련: [dispatch.ko.md](dispatch.ko.md) 8장(2b → 3 기준), [occ.ko.md](occ.ko.md) 7장·11장(S3), [fleet.ko.md](fleet.ko.md) 4장(분류), `server/landing.ts`(CLEARED TO LAND), `server/proposals.ts`(`gate3Of`), `server/crosscheck.ts`(일치율, 한 번 클릭 수), `server/logbook.ts`(LOGBOOK).

## 1. 지금 사실

2026-09-27에 돌고 있는 atc에서 읽기만 해서 모았다(`/api/dispatch/brief`, `/api/schedule/brief`, `/api/logbook`, `/api/metrics`, `/api/snapshot`). 운영 상태에는 아무것도 쓰지 않았다.

| 항목 | 수치 | 3단계에 주는 뜻 |
|---|---|---|
| DISPATCH | 아직 2a(그림자). 그림자 판정 6건, 일치 2건(33%). 2b로 보낸 FLIGHT PLAN이 0건이라 `gate3`에 데이터가 없다 | 자동 배정까지는 적어도 "2b 게이트 + 2b 2주"가 남았다. 아래 규칙은 그보다 훨씬 먼저 그림자로 돌 준비가 돼 있어야 한다 |
| DISPATCH 거절 | 거절 사유: 이미 완료됨(VOC-56 ruleset), 사람 결정 대기(VOC-177), RELEASE 하나는 상위 이슈(VOC-34). 거절된 ASSIGN 3건 중 2건에 OCC CAUTION이 있었다. 승인된 CAUTION ASSIGN 1건(D-0013, VOC-193)은 SEC 팀에 준 보안 작업이었다 | 위험한 경우는 대부분 CAUTION이 잡는다. CAUTION을 자동화에서 빼는 것([dispatch.ko.md](dispatch.ko.md) 9장)은 근거가 있다 |
| SCHEDULE | S1(그림자). 판정 7건, 일치 4건(57%). 거절 3건은 모두 CLASSIFY 오독이었다(MAINT를 BUILD로 2번, L인 WAKE를 M으로). PR #29에서 고쳤고, 그 뒤 첫 초안(S-0010, VOC-181)은 맞았다 | CLASSIFY 품질이 나아지는 중이다. S3 게이트는 #29 이전이 아니라 이후 데이터로 판단해야 한다 |
| CROSSCHECK | SCHEDULE: mark 7건 중 7건이 SUPERVISOR와 맞았다(모델 이름을 기록하기 전 mark 5건, Muse 2건). DISPATCH: 판정된 mark 0건. 한 번 클릭 판정: 0건 중 0건(버튼이 새로 생김) | 두 번째 모델이 사람과 같은 판단을 한다는 증거는 SCHEDULE에만 있고, 그것도 적다 |
| LOGBOOK(14일) | 머지된 PR 62건: `chaehy5665/atc` 32, `chaehy5665/vocado_nextjs` 30. 되돌림 0, CHANGES_REQUESTED 0, LOS 0. Codex가 vocado PR 30건 중 8건에서 문제를 찾았다 | 지금까지 머지는 잦고 깨끗하다 |
| LANDING 대기(PR 열림 → 머지) | 전체: 중앙값 13분, p75 147, p90 439, 최대 1,734(29시간). atc: 중앙값 2, p90 12. vocado: 중앙값 142.5, p90 583 | 흐름 관리가 필요한 대기열은 atc가 아니라 vocado다 |
| 머지 간격 | 같은 저장소에서 연속 머지 사이 시간: atc 중앙값 11분(간격 31개 중 14개가 10분 미만), vocado 중앙값 21분(29개 중 12개가 10분 미만) | 연달아 머지하는 일이 흔하다. vocado에서는 머지마다 다른 열린 PR이 `BEHIND`가 되고 CI가 다시 돌 수 있다 |
| Block time(DEPARTED → PR 열림) | 62건 중 13건만 알 수 있다: 중앙값 9분, p90 31 | WAKE 기대치를 맞추기엔 아직 너무 적다 |
| 귀속 | LOGBOOK 62건 중 48건에 AIRCRAFT가 없고, 46건에 FLIGHT나 분류가 없다 | AIRCRAFT별·WAKE별 수치는 아직 믿기 어렵다 |
| TOWER | 운용 2일(1.5 준비 조건은 3일). CLEARANCE 11건(LAND 1, INFO 10), READBACK 100%, 중앙값 0.2분 안. LANDING: 요청 11건, LAND 완료 4건, 대기 중앙값 2.3분, 최대 444분 | READBACK 규율은 좋다. LAND 건수는 아직 아주 적다 |
| 지금 열린 PR | CLEARED 1건(vocado #389). vocado_RN PR은 모두 `no-checks`로, DesignLAB PR은 `no-review`로 막혀 있다 | CLEARED에 끝내 닿지 않는 AIRPORT가 있다. 슬롯 규칙은 모든 저장소에 CI가 있다고 가정하면 안 된다 |

## 2. 원칙

1. **움직이기 전에 그림자로.** 모든 규칙은 먼저 사람의 결정 옆에서 "X를 했을 것"으로 돈다. 적어도 2주, 그리고 최소 건수를 채운다. 그림자 기록이 기준을 넘은 뒤에만 SUPERVISOR가 켠다.
2. **사람을 잰다. 자동화는 사람으로 세지 않는다.** 자동 결정에는 `via: "atfm"`이 붙고, 2a/S1 일치 게이트와 CROSSCHECK 일치율에 절대 세지 않는다. 그러지 않으면 자동화가 자기를 채점하게 된다.
3. **좁게, 되돌릴 수 있게.** 자동화는 구조상 위험이 낮은 경우만 맡는다(`SEC` 없음, CAUTION 없음, 명시한 라벨, CROSSCHECK agree). 장치마다 스위치, 하루 한도, 스스로 끄는 trip 조건이 있다.
4. **보호하는 통제가 먼저.** GROUND STOP과 머지 슬롯은 속도를 늦추기만 한다. 그래서 일을 승인하는 어떤 것보다 먼저 켤 수 있다.
5. **guard는 지금과 같다.** 새 쓰기 경로도 send-guard, linear-guard, Bash guard를 건너뛰지 않는다. 자동 FLIGHT PLAN과 Linear 호출은 기존 release 명령을 거친다. 그래서 guard가 여전히 정확한 문구와 입력을 비교한다.

## 3. 위험이 낮은 자동 배정 (DISPATCH 3단계)

**목적.** 일상적인 ASSIGN은 SUPERVISOR를 기다리지 않고 FLIGHT PLAN으로 보낸다. 쉬는 AIRCRAFT가 분명한 일을 더 빨리 받는다. 판단이 필요한 것은 여전히 사람에게 간다.

**규칙: 아래를 모두 만족해야 ASSIGN이 자동 대상이다.** planner는 열린 ASSIGN마다 `auto` 판정과 못 맞춘 조건 목록을 계산한다.

| # | 조건 | 이유 |
|---|---|---|
| A1 | FLIGHT에 **명시한** `type:`·`wake:` 라벨이 있다(기본값 BUILD · M이 아님) | 기본값은 SCHEDULE에서 본 바로 그 잘못된 분류를 가린다 |
| A2 | WAKE가 `L`이나 `M` | `H`는 리뷰가 여러 번 필요하고, `J`는 나눠야 한다 |
| A3 | FLIGHT TYPE이 `BUILD`, `MAINT`, `FERRY`(결정 1: SURVEY 제외) | `SURVEY`와 `TEST`는 결과가 열려 있다. `CHECK`는 검토하는 BUILD와 독립이어야 한다 |
| A4 | `rating:SEC`도, Risk 그룹 라벨도 없다 | SEC는 절대 자동이 아니다([fleet.ko.md](fleet.ko.md) 4.3, [occ.ko.md](occ.ko.md) 7장) |
| A5 | OCC가 검토했고(`note` 있음), CAUTION도 HOLD도 없다 | 지금까지 거절된 ASSIGN 3건 중 2건에 CAUTION이 있었다 |
| A6 | FLIGHT에 `tail:`이 있으면 이 AIRCRAFT를 가리킨다. 없으면 FLIGHT의 프로젝트가 이 AIRCRAFT의 ROUTES에 있다 | 미리 정한 배정이나 늘 맡는 영역은 SUPERVISOR가 전에 내린 결정이다 |
| A7 | 허용된 모델의 CROSSCHECK `agree` mark가 OCC 메모 뒤에 기록됐다 | 아무도 보지 않게 되기 전에, 독립된 검토자 둘이 동의한다 |
| A8 | AIRCRAFT가 PARKED이고, AOG가 아니고, 필요한 TYPE RATING을 모두 가졌고, 최근 7일에 NO READBACK도 DECLINED도 없고, 아직 ARRIVED하지 않은 STAND 없는 FLIGHT를 날고 있지 않다([fleet.ko.md](fleet.ko.md) 5.1.1) | 답하지 않는 팀에 일을 자동으로 더 주면 안 된다. SURVEY나 CHECK를 나는 팀은 세션이 쉬고 있어도 바쁘다 |
| A9 | FLIGHT에 우선순위가 있고, 상위 이슈가 아니고, 전에 DECLINED되거나 거절된 적이 없다 | 이것들이 나머지 실제 거절 사유다 |
| A10 | 그 AIRPORT에 실제로 막는(enforced) GROUND STOP이 없고(6장), 한도에 여유가 있다(7장): 전체 하루 자동 ASSIGN 3건, 그리고 AIRCRAFT당 아직 ARRIVED하지 않은 자동 배정 FLIGHT 1건까지. WAKE 슬롯과 함께 센다(결정 3) | 흐름 관리가 배정보다 우선이다 |

**켜는 조건**(모두 만족해야 한다. 데이터로 확인하고, DISPATCH 탭의 기존 게이트 옆 "STAGE 3" 패널에 보인다):

1. 2b를 2주 이상 돌렸고 `gate3`가 준비됐다. [dispatch.ko.md](dispatch.ko.md) 8장의 기준은 2주 이상, READBACK 90% 이상, DEPARTED 80% 이상, DISPATCH가 보낸 FLIGHT의 LOS가 거의 0, 유휴 AIRCRAFT 시간 감소다. 코드(`gate3Of`, `GATE3`)는 사람이 승인해 보낸 FLIGHT PLAN 10건 이상, READBACK 90% 이상, DEPARTED 80% 이상을 본다. 10건 최소치는 코드가 정한 것이다. LOS는 아래 5번 조건이 본다. 2주 기간은 FLIGHT RECORDER의 마지막 DISPATCH `mode:` 전환에서 잰다(`approvalRunOf`). `approval`로 14일 이상이면 통과다. 모드는 `approval`인데 마지막 전환 기록이 그렇지 않으면(파일을 직접 고쳤거나 전환이 기록 보존 기간 30일보다 오래됨) 판정 대신 "확인 필요"를 보인다. 유휴 AIRCRAFT 시간 감소는 재지 않는다: 아직 만들지 않음. DEPARTED 비율은 STAND가 필요한 FLIGHT만 센다. STAND 없는 FLIGHT는 READBACK 때 DEPARTED하므로 READBACK 비율에만 들어가고, `gate3.standFree`로 따로 보인다.
2. **자동 대상의 그림자 정밀도**: SUPERVISOR가 판정한 자동 대상 ASSIGN이 20건 이상이고, 그중 95% 이상이 승인됐고, `already-done`, `parent-issue`, `waiting-on-prior`, `needs-human`으로 거절된 것이 하나도 없다.
3. **DISPATCH의 CROSSCHECK, 모델 계열별**: 지금 쓰는 모델 계열(`byModel`, `modelFamily`로 묶음)의 mark가 달린 판정 20건 이상, 일치 90% 이상.
   - 전체 비율로는 부족하다. 모델이 이미 한 번 바뀌었기 때문이다.
   - 계열은 같은 모델이 경로마다 다르게 받는 이름을 합친다: `claude-ocx-opencode-go--muse-spark-1.3-contributor`, `…[1m]`, `muse-spark-1.3-contributor`는 모두 `muse-spark-1.3`로 센다.
   - 모델 이름이 생기기 전의 mark는 `unknown`으로 읽는다. 따로 한 줄로 보이지만, "지금 계열"이 되지 않고 이 조건에도 세지 않는다.
4. **한 번 클릭 비율**: 자동 대상 ASSIGN 중 SUPERVISOR가 "CROSSCHECK에 동의"(`oneClick`)로 승인한 비율. 게이트가 아니라 뒷받침하는 증거다. 비율이 높으면 그 판정이 이미 일상이라는 뜻이지만, 재는 것은 편리함이지 옳음이 아니다.
5. 최근 2주 동안 DISPATCH가 보낸 FLIGHT가 낀 LOS가 없다.

**끄기와 되돌리기.**

- 스위치: `atfm.json` `autoAssign`(결정 10). 지금은 `off | shadow`만 받는다(기본 `shadow`: 계산하고 보이고 기록한다). `on`은 자동 배정 PR과 함께 온다.
- 자동 trip(스위치가 `shadow`로 돌아가고 경보가 뜬다):
  - 자동으로 보낸 FLIGHT PLAN이 DECLINED되거나, 10분 뒤에도 NO READBACK이다.
  - SUPERVISOR가 자동 승인된 제안을 SUPERSEDED하거나 RECALL한다.
  - 자동으로 보낸 FLIGHT가 LOS에 낀다.
  - 최근 20건 판정에서 지금 모델 계열의 CROSSCHECK 일치가 85% 아래로 떨어진다.
- FLIGHT 하나 되돌리기: 이미 보낸 FLIGHT PLAN은 보낸 그대로 둔다(2b를 끌 때처럼). SUPERVISOR는 자동으로 보낸 제안을 **RECALL**할 수 있다. OCC가 정해진 `[DISPATCH D-xxxx] RECALL` 문구를 보내고(send-guard는 `recalling`인 제안에만 허용), CAPTAIN이 `READBACK D-xxxx RECALL`로 답한다. 결정 4: 자동 배정보다 먼저 구현됨 — [dispatch.ko.md](dispatch.ko.md) "RECALL" 참고.

**지표.** 자동 대상 건수와 못 맞춘 조건 분포, 그림자 정밀도, 하루 자동 발송 수, 자동 발송과 사람 승인 FLIGHT PLAN의 READBACK·DEPARTED 비율, DECLINED, RECALL, 자동 FLIGHT의 LOS, WAKE 기대치(`WAKE_EXPECT_MIN`) 대비 block time(AIRCRAFT와 분류가 있는 LOGBOOK 항목이 충분히 쌓인 뒤).

**필요한 데이터.** 더 많은 FLIGHT에 명시한 라벨(LOGBOOK 62건 중 분류된 것은 16건), DISPATCH의 CROSSCHECK mark(아직 판정된 것 없음), LOGBOOK의 AIRCRAFT 귀속(62건 중 48건 없음), 그리고 2b가 일단 돌기 시작해야 한다.

## 4. S3 자동 처리 (OCC)

**목적.** OCC가 일상적인 계획 필드 변경을 승인 클릭 없이 적용하게 한다. 분류 라벨부터 시작한다. 위험을 바꾸는 것은 계속 사람이 한다.

**규칙: 아래를 모두 만족해야 SCHEDULE 작업이 자동 대상이다.** S1–S4는 조건 코드다. `s3Eligibility`가 못 맞춘 조건으로 내놓는 코드와 같다. OCC 단계 S1–S3([occ.ko.md](occ.ko.md) 11장)이 아니다. 이 장 제목의 S3는 단계다. 조건과 그 아래에서 단계를 말할 때는 "S2 단계", "S3 단계"로 쓴다.

| # | 조건 |
|---|---|
| S1 | 종류가 `CLASSIFY`이고, 라벨이 없는 축에 라벨을 **더하기만** 한다(호출에 `removeLabels` 없음). 있는 라벨을 바꾸는 것은 사람의 결정이다(결정 5: 지금 S3 단계 범위는 이것이 전부) |
| S2 | `rating:SEC`를 더하지 않고, FLIGHT에 `rating:SEC`, Risk 그룹 라벨(`Risk:Security`, 또는 옛 단독 라벨 `Risk: Security`. `classOf`는 `Risk:` 라벨을 모두 SEC로 읽는다), 그 FLIGHT의 DISPATCH 제안에 붙은 OCC CAUTION이 없다. atc가 FLIGHT를 읽지 못하면 S2에서 떨어진다: SEC 작업은 절대 자동이 아니다 |
| S3 | 이 초안에 허용된 모델의 CROSSCHECK `agree` mark가 있고, OCC 사유가 정하는 축마다 fleet.md의 절을 인용한다(#29 규칙) |
| S4 | FLIGHT가 Todo나 Backlog이고 어느 팀도 날고 있지 않다: STAND가 없고, 승인에서 ARRIVED 사이의 DISPATCH 제안이 없다(`isInFlight`. READBACK 때 DEPARTED한 STAND 없는 FLIGHT도 포함). `tail:` 라벨만으로는 막지 않는다. 미리 배정일 뿐이다 |

조건이 하나 더 있지만 초안마다 보는 것은 아니다. S2 단계(승인 운용)가 켜져 있어야 한다. 그래야 Linear 호출이 atc가 release하고 linear-guard가 비교하는 호출이 된다. 이 조건은 모든 초안에 한꺼번에 맞거나 한꺼번에 안 맞는다. 그래서 아래 켜는 조건 1번이 본다.

나중 후보. 각각 자기 S2 단계 기록이 쌓인 뒤에만 본다([occ.ko.md](occ.ko.md) 7장).

- 결정 5: 머지 뒤 `CLOSE`는 S2 단계를 2주 돌린 뒤 검토한다.
- `CLOSE`를 Done으로: FLIGHT의 PR이 LOGBOOK에 머지로 있고, 되돌리지 않았고, 1시간이 지났고, 본문의 완료 기준 칸이 모두 체크됐을 때(OCC가 읽는다). `CLOSE` 초안은 구현됐다([occ.ko.md](occ.ko.md) 5.5절). 하지만 atc는 이를 release하지 않고, SUPERVISOR가 Linear에서 Done으로 옮긴다. 자동 `CLOSE`는 아직 만들지 않음.
- `LINK`: 본문에서 그대로 인용한 선행 작업.
- `PRIORITIZE`는 사람이 한다. 우선순위는 SUPERVISOR의 계획을 따르는데, 티켓 본문에는 그 계획이 거의 적히지 않는다.
- 절대 자동이 아닌 것: `rating:SEC` 추가·제거, CAUTION, `Canceled`, 삭제, AIRBORNE 팀의 `tail:` 바꾸기.

**켜는 조건.**

1. S2 단계를 2주 돌렸고([occ.ko.md](occ.ko.md) 11장. 3장 1번처럼 마지막 SCHEDULE `mode:` 전환에서 잰다), 사람이 되돌린 APPLIED 작업이 없다. "되돌림"은 OCC가 더한 라벨이 7일 안에 사라진 것으로 감지한다.
2. #29 이후 쓴 CLASSIFY 초안에 대한 사람 일치: 판정 20건 이상, 일치 85% 이상.
3. SCHEDULE CLASSIFY의 CROSSCHECK, 지금 모델 계열별(3장과 같음, `unknown`은 세지 않음): mark 20건 이상, 일치 90% 이상(지금: 7건 중 7건, 그중 5건이 `unknown`).
4. 그림자 정밀도: 판정된 자동 대상 초안 20건 이상, 승인 95% 이상.

**끄기와 되돌리기.** 스위치는 `atfm.json` `s3`(지금 `off | shadow`, 기본 `shadow`). `shadow`로 돌아가는 trip:

- 규칙이 대상이라고 한 초안을 사람이 거절함(그림자일 때), 또는 자동 적용된 라벨을 사람이 지움(`on`일 때)
- linear-guard가 막음
- 지금 모델 계열의 일치가 85% 아래로 떨어짐

적용된 CLASSIFY 하나 되돌리기: atc가 반대 작업(더한 라벨만 정확히 빼기)을 보통 S2 단계 초안으로 쓰고, SUPERVISOR가 승인한다. 자동으로 지우는 것은 없다.

**지표.** 하루 대상 수와 적용 수, 7일 안에 되돌려진 수, CLASSIFY 사람 일치, 계열별 CROSSCHECK 일치, 나중에 DISPATCH가 찾은 라벨 불일치(자동 적용 뒤 제외되거나 다시 분류된 FLIGHT).

**필요한 데이터.** #29 이후 CLASSIFY 판정, S2 단계 켜기, Linear 소스에서 라벨 제거 감지(가져올 때마다 라벨 비교).

## 5. 머지 슬롯

**목적.** LANDING SEQUENCE가 헛돌지 않게 한다. 브랜치 보호가 최신 브랜치를 요구하는 저장소에서는, 머지 한 번마다 다른 CLEARED PR이 `BEHIND`가 될 수 있다. 그러면 각 PR이 rebase하고 CI를 다시 돌린다. 이것이 문제 되는 곳은 vocado 대기열이다(대기 중앙값 142분, p90 583). atc(중앙값 2분, CI 없음)는 필요 없다.

**규칙.**

- **저장소·base별 슬롯.** LAND CLEARANCE를 받고 아직 머지되지 않은 PR은 한 번에 N개까지다.
  - 결정 6: vocado_nextjs는 1, CI 없는 저장소(atc 등)는 제한 없음.
  - 코드에서는 기본 브랜치 head에 체크가 하나라도 있으면 1, 없으면 제한 없음. `atfm.json` `slotLimits`(AIRPORT 코드 → 숫자나 `null`)가 이를 덮어쓴다.
  - CLEARED지만 슬롯 밖인 PR은 번호를 가진 채 순서에 남는다. 7번부터는 슬롯에 들 때까지 TOWER가 LAND를 보내지 않는다.
- **순서.** 이미 LAND를 쥔 PR이 먼저이고, 절대 밀려나지 않는다. 다음은 Urgent 우선순위 FLIGHT, 나머지는 `readyAt` 순(결정 6).
- **간격.** 같은 저장소의 다음 LAND는 앞 PR이 머지됐거나, 앞 LAND가 LAND 제한 시간(30분)보다 오래됐을 때 나간다.
  - 결정 7: atc의 LANDING 대기 p90이 12분이라 30분이면 여유가 있다. vocado의 더 긴 LOGBOOK 대기는 PR 열림부터 머지까지다. 여기에는 PR이 CLEARED 되기 전의 리뷰 시간이 들어 있어서, LAND 뒤 시간보다 크게 나온다.
  - 제한 시간을 넘긴 LAND는 SUPERVISOR에게 보고하고 슬롯을 비운다.
- **rebase 비용.** 열린 PR이 `BEHIND`가 되면 기록한다(`behind`). 그래서 머지당 `BEHIND` 수를 셀 수 있다. 슬롯 수는 결정 6대로 둔다. 바꾸는 것은 SUPERVISOR뿐이고, `slotLimits`로 바꾼다. 처음 제안한 자동 조정(하루 평균 머지당 2개 넘게 `BEHIND`가 되면 1로 둠, CI 중앙값이 10분 미만이면 2로 올림)은 아직 만들지 않음. 만들려면 새 결정이 필요하다.
- **어디서 도나.** atc가 `landingQueue`의 PR마다 `slot`(`in-slot` / `waiting-slot`)을 계산한다. 7번부터 TOWER 규칙은 `in-slot` PR에만 LAND를 준다. 구현됨(ATC-22): `slots: on`이면 `waiting-slot` PR에 `slotHold`(`slotHoldOf`, 한 줄 이유)가 붙고, TOWER는 그 PR에 LAND도 메시지도 보내지 않는다. 그림자면 `slot`만 있고 TOWER는 따르지 않는다. 새 쓰기 경로는 없다.

**켜기.** 1주 동안 그림자로 돌린다(STRIPS에 `waiting-slot`을 보이고, TOWER는 지금처럼 LAND를 준다). 그 뒤 비교한다: 같은 저장소에서 LAND 둘이 동시에 살아 있던 횟수, 머지마다 `BEHIND`가 된 PR 수. 구현됨: `GET /api/atfm`의 `data.lands`가 AIRPORT마다 7일 동안 나간 LAND, 같은 AIRPORT의 다른 LAND와 함께 살아 있던 LAND 수(`concurrent`), LAND → 머지 중앙값, 30분 안에 머지되지 않은 LAND를 준다(`landSpansOf`가 LAND를 그 STAND, STAND가 없으면 FLIGHT의 첫 LOGBOOK ARRIVED에 짝짓는다. 짝이 없는 LAND는 취소 시각이나 시간 제한에 끝난다. `landFiguresOf`). `data.behind`(머지당 BEHIND) 옆에 있고, DISPATCH 탭 ATFM 블록의 슬롯 스위치 아래 "켜기 판단 (7일)"에 보인다. 충족·미달 기준은 없다. SUPERVISOR가 비교한다.

**끄기.** `atfm.json` `slots`(`off | shadow | on`, 기본 `shadow`). SUPERVISOR가 DISPATCH 탭 ATFM 블록에서 확인을 거쳐 바꾼다. ATFM OFF는 `on`을 `shadow`로 되돌린다.

**지표.** 저장소별 LANDING 대기(중앙값, p90), LAND → 머지 시간, 머지당 BEHIND 수, PR당 CI 재실행, LAND 제한 시간 초과.

**필요한 데이터.** PR별·check run별 CI 시간(check run의 `startedAt`은 CLEARED TO LAND용으로 이미 가져온다. `completedAt`을 더해야 한다), 머지당 BEHIND 전환(연속 snapshot에서), 저장소마다 최신 브랜치를 요구하는지(브랜치 보호, 읽기 전용 `gh api`).

## 6. GROUND STOP

**목적.** 시스템 자체에 문제가 있으면 부하를 더하지 않는다. 원인이 사라질 때까지 새 배정을 멈추고, 도움이 되면 새 머지도 멈춘다.

- **GROUND STOP**은 AIRPORT 하나의 새 ASSIGN을 멈춘다(표에 적힌 경우 LAND도).
- **GROUND DELAY**는 그 AIRPORT의 AIRBORNE 슬롯을 하나 줄이기만 한다.

**trigger와 해제**(AIRPORT별, 곧 저장소별):

| trigger | 멈추는 것 | 풀리는 때 |
|---|---|---|
| **main 깨짐**: 기본 브랜치 head의 필수 체크가 실패 | 그 AIRPORT의 새 ASSIGN과 모든 LAND(새 작업이 깨진 base에서 갈라지고, 머지가 쌓인다) | 기본 브랜치 head가 초록이 되거나, SUPERVISOR가 푼다 |
| **CI 실패 몰림**: 같은 저장소의 PR 3개 이상이 1시간 안에 같은 체크에서 실패 | 새 ASSIGN과 LAND | 실패한 체크가 더 새로운 head에서 PR 2개에 통과하거나, SUPERVISOR가 푼다 |
| **CI 혼잡**: 체크가 30분 넘게 도는 PR이 4개 넘음, 또는 최근 2시간 체크 시간 중앙값이 그 앞 7일 중앙값의 2배를 넘음(표본 3개·10개 이상) | GROUND DELAY: AIRBORNE 슬롯 −1. 대기열이 빠지도록 LAND는 계속 | 30분 동안 기준 아래 |
| **LOS 증가**: AIRPORT에 열린 LOS 2건 이상, 또는 24시간 안에 그 AIRPORT에서 난 LOS 3건 이상 | 새 ASSIGN | 30분 동안 두 기준 모두 아래 |
| **수동**: SUPERVISOR가 사유와 함께 GROUND STOP 선언 | SUPERVISOR가 고른 것 | SUPERVISOR가 푼다 |

구현된 해제(ATC-62): "main 깨짐"과 "수동"은 trigger가 더는 맞지 않는 첫 snapshot에서 끝난다. 혼잡과 LOS는 trigger가 30분 이어서 풀려 있어야 끝난다. 그 30분 안에 다시 걸리면(깜빡이는 trigger) 같은 멈춤이 같은 시작 시각으로 이어지고 30분을 다시 센다. 실패 몰림은 실패한 체크가 멈춘 뒤 끝난 실행에서 PR 2개에 통과해야 끝난다. PR 1개로는 모자란다. 해제를 기다리는 멈춤은 남은 것을 보인다(`releasing`: "기준 아래 12분 / 30분", "build 통과 PR 1/2 (#381)"). "SUPERVISOR가 푼다"는 그 trigger 스위치를 `shadow`나 `off`로 내리거나 ATFM OFF를 누르는 것이다. 자동 멈춤에는 하나씩 푸는 버튼이 없다.

Codex 사용 한도 알림(`no-review`에서 "Codex 한도"로 멈춘 PR)은 GROUND STOP이 아니라 INFO로 알린다. 그것만으로 이미 머지를 막기 때문이다.

**누가 무엇을.**

- **atc**는 snapshot에서 `groundStops`(AIRPORT, 종류, trigger, 시작 시각, 근거)를 계산한다. ALERT와 AIRPORTS·STRIPS 탭에 보이고, 시작과 끝을 FLIGHT RECORDER에 기록한다.
- **planner(DISPATCH)**는 멈춘 AIRPORT를 `GROUND STOP — <trigger>` 사유로 뺀다. 거기서 승인됐지만 아직 보내지 않은 ASSIGN은 잡아 둔다(멈춘 동안 `dispatch release`가 거부한다).
- **TOWER**는 멈춘 AIRPORT에 LAND를 주지 않는다. 멈춤이 시작되면 그 AIRPORT의 CLEARED PR을 쥔 쪽에 `HOLD` CLEARANCE를 한 번 보낸다("GROUND STOP: <trigger> — LAND 보류"). 멈춤이 끝나면 `CONTINUE`를 보내고 순서대로 LAND를 다시 준다.
- **OCC**는 멈춘 AIRPORT에 FLIGHT PLAN을 쓰지 않고, 멈춤을 OCC LOG에 적는다. "main 깨짐"이면 실패한 체크와 커밋을 SUPERVISOR에게 보고한다(읽기 전용 `gh`).

**켜기.** 1주 동안 그림자로 돌린다. trigger를 계산하고 보이기만 하고, 아무것도 멈추지 않는다. `on` 전에 SUPERVISOR가 잘못 걸린 경우(예: 들쭉날쭉한 체크)를 보고 기준값을 고친다.

**스위치**(`atfm.json` `groundStop`, 결정 8):

- `mainBroken`, `failureWave`, `congestion`, `los: off | shadow | on`(기본 `shadow`, ATC-62)
- `manual: off | on`(기본 `off`)

켜는 것은 SUPERVISOR 몫이다(ATC-23). ATFM OFF는 `on`을 모두 `shadow`로 되돌린다. 켜면 "main 깨짐"과 "실패 몰림"은 그 AIRPORT의 새 ASSIGN과 LAND를 모두 멈추고, "LOS"는 새 ASSIGN만 멈춘다(TOWER는 계속 LAND를 주고 HOLD를 보내지 않는다). "혼잡"은 AIRBORNE 슬롯 하나를 빼는 GROUND DELAY다. 수동 멈춤은 AIRPORT마다 사유와 함께 선언하고, 손으로 푼다.

**지표.** trigger별 주간 멈춤 수, 지속 시간, 잘못 걸린 비율(SUPERVISOR가 10분 안에 손으로 푼 멈춤), 잡아 둔 배정과 LAND.

**필요한 데이터.** 저장소별 기본 브랜치 head의 체크 상태(읽기 전용 `gh api repos/<slug>/commits/<branch>/check-runs`, PR 목록과 함께 poll), 체크 시간(5장). AIRPORT별 LOS는 이미 snapshot에 있다.

## 7. 안전장치 (모든 자동 동작)

| 안전장치 | 규칙 |
|---|---|
| 스위치 | 모두 `~/.local/state/atc/atfm.json`에 있다(결정 10). 원자적으로 쓰고, 기본은 `off`나 `shadow`: `groundStop.*`, `slots`, `autoAssign`, `s3`, 그리고 `slotLimits`와 `manualStops`. "ATFM OFF" 버튼 하나(`POST /api/atfm/off`)가 모든 `on`을 `shadow`로, 수동 스위치를 off로 되돌린다 |
| 한도 | 자동 ASSIGN: 전체 하루 3건까지, 그리고 AIRCRAFT당 ARRIVED하지 않은 자동 배정 FLIGHT 1건까지. WAKE 슬롯과 함께 센다(결정 3). S3 자동 작업: 하루 5건까지. 하루는 KST 기준이다. 한도에 닿으면 대상 항목은 보통의 사람 흐름으로 돌아간다 |
| 자동 trip | 장치마다 trip 조건이 있다(3–4장). 걸리면 스위치를 `shadow`로 돌리고 경보를 띄운다. 다시 켜는 것은 SUPERVISOR가 한다 |
| 알림 | 모든 자동 동작은 `/api/events`의 이벤트이자, 그 탭 "AUTO" 목록의 한 줄이다. trip과 GROUND STOP은 ALERT다. OCC와 TOWER는 LOG 줄에 자동 동작을 적는다 |
| 기록 | 종류 `atfm`의 FLIGHT RECORDER 줄: `{op, id?, airport?, data?}`. 구현된 op는 10장에 있다(`ground-stop`(`land`, 실패 몰림이면 `check` 포함), `ground-release`(`releasedBy`: `cleared`, `30-min-below`, `passed-in-2-prs`, `switched-off`, `restart`), `ci`, `behind`, `eligible`, `s3-eligible`, `undone`, `switch`, `off`, `manual-stop`, `manual-release`, `slot-hold`). `eligible`과 `s3-eligible`에는 확인한 조건 코드(A1–A10, S1–S4)가 `checked`로 남는다. 아직 만들지 않음: `auto-approve`, `auto-apply`, `trip`, 그리고 함께 올 `rule`·`inputs` 필드. `inputs`는 조건마다 근거가 된 값의 snapshot이 될 것이다. 그래서 어떤 자동 동작이든 나중에 설명할 수 있다 |
| 귀속 | 자동 승인은 `by: "atfm"`, `via: "atfm"`인 `approve` op다. 사람 게이트와 CROSSCHECK 일치율에서 빠진다(원칙 2) |
| guard | 자동 FLIGHT PLAN은 `dispatch release`와 send-guard를, 자동 Linear 쓰기는 `schedule release`와 linear-guard를 거친다. 어느 guard에도 우회로가 없다 |

## 8. 구현 순서

번호 하나가 PR 하나다. 그림자 번호는 팀이나 Linear가 보는 것을 아무것도 바꾸지 않는다.

1. **데이터**(그림자 필요 없음): 저장소별 체크 시간과 기본 브랜치 head 상태 기록, 머지당 BEHIND 전환, Linear 소스의 라벨 제거 감지, `atfm` recorder 종류. 동작 변화 없음.
2. **GROUND STOP, 그림자**: `groundStops` 계산, ALERT, AIRPORTS/STRIPS 표시, recorder. 아무것도 멈추지 않는다.
3. **머지 슬롯, 그림자**: `landingQueue`의 `slot`, STRIPS에 표시. TOWER는 그대로.
4. **DISPATCH 자동 대상, 그림자**: 열린 ASSIGN마다 `auto` 판정과 못 맞춘 조건, 그림자 정밀도가 있는 "STAGE 3" 패널. 사람 결정과 비교만 하므로 2a 중에도 시작할 수 있다.
5. **S3 자동 대상, 그림자**: CLASSIFY 초안에 같은 것.
6. ✅ **GROUND STOP 켜기**: planner 제외, `dispatch release` 거부, TOWER HOLD/CONTINUE 규칙, 해제 규칙, GROUND DELAY. SUPERVISOR가 1주 그림자 결과를 받아들일 때까지 `shadow`인 스위치 뒤에 구현(ATC-23).
7. ✅ **머지 슬롯 켜기**: TOWER가 `in-slot` PR에만 LAND를 준다. `slots` 스위치 뒤에 구현(ATC-22), 기본 `shadow`.
8. ✅ **RECALL**(`[DISPATCH D-xxxx] RECALL`, send-guard 확장) — 구현됨([dispatch.ko.md](dispatch.ko.md) "RECALL"). 자동 배정 전에 필요하다.
9. **자동 배정 켜기**: 스위치, 한도, trip, 귀속. 3장의 켜는 조건을 만족한 뒤에만.
10. **S3 자동 CLASSIFY 켜기**: 4장의 켜는 조건을 만족한 뒤.

1–5번은 구현됐다(10장). 6번도 구현됐다: 먼저 "main 깨짐"과 "수동"(결정 8), 다음에 실패 몰림·혼잡·LOS의 해제 규칙, 두 번째 trigger, `on` 스위치(ATC-62). 스위치 다섯 개는 기본 `shadow`(수동은 `off`)이고, SUPERVISOR가 켜기 전에는 하나도 켜지지 않는다. 7번(머지 슬롯)은 `slots` 스위치 뒤에 구현됐고 기본은 `shadow`다(ATC-22). 8번(RECALL)도 구현됐다(결정 4). 다음은 9번 자동 배정이고, 3장의 켜는 조건을 만족하면 한다.

## 9. 위험과 대응

| 위험 | 대응 |
|---|---|
| 자동화가 자기를 채점함 | `via: "atfm"`은 모든 일치 수치에서 빠진다 |
| 들쭉날쭉한 체크가 GROUND STOP을 일으킴 | 먼저 1주 그림자, 잘못 걸린 비율 지표, 손으로 풀기, CI 실패 몰림은 PR 3개가 필요 |
| 필요 없는 저장소까지 슬롯이 늦춤 | CI 없는 저장소는 기본이 제한 없음, 저장소별 설정 |
| 실제로는 바쁜 팀에 자동 FLIGHT PLAN이 감 | A8(PARKED, 최근 NO READBACK·DECLINED 없음), AIRCRAFT당 끝나지 않은 자동 FLIGHT 1건까지, RECALL |
| 라벨이 흐트러져 A1–A4가 틀림 | A1은 명시한 라벨을 요구, S3는 빈 축에만 라벨을 더함, CLASSIFY 사람 일치가 S3 게이트에 들어감 |
| 데이터가 모자라 영영 못 켬 | 그림자 대상 판정(4–5번)은 구현됐고, 2a·S1 중에 돈다. 그래서 정밀도 기록이 나란히 쌓인다 |

## 10. 구현된 것 (1–7번)

| 부분 | 위치 | 하는 일 |
|---|---|---|
| 기본 브랜치 CI | `server/sources/github.ts`(`readMain`) | GitHub poll(90초)마다 AIRPORT별 기본 브랜치 head의 check-run과 commit status를 읽는다(읽기 전용 `gh api`). `mainStateOf`가 이를 `success`, `failure`, `pending`, `none`(CI 없음)으로 바꾼다. `snapshot.atfm.mains`에 보인다 |
| 체크 시간 | `server/atfm.ts` `ciMinutesOf` | PR head의 check run이 모두 끝나면, 가장 이른 시작부터 가장 늦은 끝까지 잰다. 이제 PR 목록과 함께 읽는 `completedAt`을 쓴다 |
| GROUND STOP | `server/atfm.ts` `groundStopsOf`, `holdStops`, `server/snapshot.ts` | snapshot마다 계산한다: main 깨짐, CI 실패 몰림(1시간 안에 PR 3개가 같은 체크에서 실패, 체크 이름으로 잇는다), CI 혼잡(체크가 30분 넘게 도는 PR이 4개 넘음, 또는 2시간 중앙값이 7일 중앙값의 2배 넘음. GROUND DELAY), LOS(AIRPORT에 열린 것 2건 이상, 또는 24시간 안 3건 이상), 수동. `holdStops`가 해제 규칙(6장)까지 멈춤을 붙들고 `clearSince`·`releasing`을 채운다. `enforced`는 그 trigger 스위치가 켜져 있을 때 true, `land`는 LAND도 막는지다. 재시작하면 `atfm-state.json`의 `stops`에 적힌 멈춤을 되살리고 해제 규칙을 재시작 때부터 센다. 두 번째 trigger 수치(`ci` 줄의 `ciTrendOf`, LOS 이벤트의 `losDayOf`)는 `server/atfm-run.ts`가 1분마다 FLIGHT RECORDER에서 다시 센다. `snapshot.atfm.groundStops`에 보인다 |
| 적용(켰을 때만) | `server/proposals.ts`, `server/controller.ts`, `server/events.ts`, TOWER·OCC `CLAUDE.md` | planner가 멈춘 AIRPORT의 ASSIGN을 `GROUND STOP — …`로 `excluded`에 옮긴다. 그래서 거기 열린 제안은 그 사유로 SUPERSEDED된다. `dispatch release`는 거부한다. TOWER 브리핑이 LAND를 막는 멈춤(`enforcedStops(…, "land")`: main 깨짐, 실패 몰림, 수동)에만 `landingQueue` 항목마다 `groundStop`을 붙이고, TOWER는 거기에 LAND를 주지 않는다. 그 멈춤에만 나는 `groundstop.started`·`groundstop.ended` 이벤트로 TOWER가 HOLD와 CONTINUE를 보낸다. LOS 멈춤은 ASSIGN만 빼고, 혼잡 GROUND DELAY는 `planDispatch`에서 그 AIRPORT의 AIRBORNE 한도를 하나 줄인다. 그림자 멈춤은 이벤트를 만들지 않는다 |
| 머지 슬롯 | `server/atfm.ts` `slotsOf`, `slotHoldOf`, TOWER 브리핑 `landingQueue[].slot`·`slotHold` | `in-slot`이나 `waiting-slot`, 줄 순서, Urgent, LAND 시각과 30분 제한 시간. `slots: on`(7번, ATC-22)이면 `waiting-slot` PR에 `slotHold`가 붙고 TOWER는 LAND를 내지 않는다. 그런 PR head는 `slot-hold`로 한 번 기록된다(`atfm-state.json`의 `slotHold`) |
| 자동 대상 판정(그림자) | `server/atfm.ts` `autoEligibility`(A1–A10), `s3Eligibility`(S1–S4) | 열린 ASSIGN과 CLASSIFY 초안마다, 못 맞춘 조건과 함께 계산한다 |
| 그림자 정밀도와 켜는 조건 줄 | `server/atfm-run.ts` `atfmView` | 정밀도는 한 번이라도 대상으로 기록된 항목을 사람 결정과 비교해 잰다. 막았어야 할 거절(`already-done`, `parent-issue`, `waiting-on-prior`, `needs-human`)도 센다. 3·4장의 켜는 조건마다 통과/실패/데이터 부족 줄이 된다(2주 줄은 "확인 필요"도 될 수 있다. `approvalRunOf`). CROSSCHECK 비율은 `unknown`이 아닌 가장 최근 mark의 계열로 잰다(`currentModelRate`) |
| 기록 | FLIGHT RECORDER 줄 `kind: "atfm"` | `ground-stop`, `ground-release`, `ci`, `behind`(열린 PR이 BEHIND가 됨), `eligible`과 `s3-eligible`(`checked` 포함), `undone`(S2로 적용한 라벨이 7일 안에 사라짐), `switch`, `off`, `manual-stop`, `manual-release`. `~/.local/state/atc/atfm-state.json`이 무엇을 기록했는지 기억해서, 재시작해도 줄이 겹치지 않는다 |
| API | `server/atfm-run.ts` | `GET /api/atfm`(스위치, main CI, GROUND STOP, 슬롯, 못 맞춘 조건이 붙은 대상 판정, 정밀도, 켜는 조건 줄, 데이터), `POST /api/atfm/switch {key, value}`, `POST /api/atfm/off`, `POST /api/atfm/stops {airport, reason}`(`groundStop.manual`이 켜져 있을 때만), `POST /api/atfm/stops/:airport/release` |
| 화면 | DISPATCH 탭 "ATFM" 블록(`web/src/views/Atfm.tsx`) | GROUND STOP(ENFORCED, LOS는 ENFORCED · ASSIGN, GROUND DELAY, 그림자. 해제 규칙을 기다리면 "해제 대기"), 확인을 거쳐 켜는 스위치(main 깨짐, 실패 몰림, 혼잡, LOS, 수동, 머지 슬롯), 수동 멈춤 입력, AIRPORT별 main CI, 슬롯, 대상 판정, S3, 데이터, ATFM OFF. 나중에 NETWORK 탭으로 옮길 수 있다 |
| 귀속 | `server/crosscheck.ts` `Via`, `humanOf`, 게이트 | `via: "atfm"`은 서버 안에서만 붙일 수 있다. `humanOf`는 여기에 아무것도 돌려주지 않는다. 2a·S1 게이트는 이를 건너뛰고, `gate3`는 사람이 승인한 FLIGHT PLAN만 세고, CROSSCHECK 비율과 한 번 클릭 수에서도 빠진다 |

## 결정 (2026-09-27, SUPERVISOR)

| # | 결정 |
|---|---|
| 1 | 자동 승인하는 FLIGHT TYPE: BUILD, MAINT, FERRY만. SURVEY는 제외 |
| 2 | 기준값은 제안대로: 그림자 정밀도 20건에 95%, CROSSCHECK 모델 계열별 일치 20건에 90%(`unknown`은 세지 않음), trip은 85% |
| 3 | 한도: 전체 하루 자동 ASSIGN 3건, 하루 S3 작업 5건. AIRCRAFT당 한도는 "하루 1건"이 아니라 진행 중 한도다: AIRCRAFT당 ARRIVED하지 않은 자동 배정 FLIGHT 1건까지, WAKE 슬롯과 함께 적용 |
| 4 | 자동 승인 전에 `[DISPATCH D-xxxx] RECALL`을 만든다 — **구현됨** |
| 5 | S3 범위: 빈 축에만 라벨을 더하는 CLASSIFY. 머지 뒤 `CLOSE`는 S2를 2주 돌린 뒤 검토 |
| 6 | 머지 슬롯: vocado_nextjs는 1, CI 없는 저장소(atc 등)는 제한 없음. Urgent FLIGHT는 자기 저장소 줄의 맨 앞으로 가지만, 이미 LAND를 받은 PR을 밀어내지는 않는다 |
| 7 | LAND 제한 시간: 30분 |
| 8 | GROUND STOP: "main 깨짐"은 새 ASSIGN과 LAND를 모두 멈춘다. 먼저 켤 수 있게 하는 것은 "main 깨짐"과 "수동"이다. CI 실패 몰림, CI 혼잡, LOS 증가는 그림자로 남는다 |
| 9 | 1–5번을 지금, 2a·S1과 나란히 만든다 |
| 10 | 스위치는 따로 `~/.local/state/atc/atfm.json`에 둔다(원자적 쓰기, 기본 off나 shadow) |

물었던 그대로의 질문을 참고로 아래에 남긴다.

## SUPERVISOR에게 물은 질문 (위에서 답함)

1. **자동 대상 FLIGHT TYPE**: BUILD, MAINT, FERRY만(제안)인가, SURVEY도 넣나?
2. **기준값**: 그림자 정밀도 20건에 95%, CROSSCHECK 모델 계열별 일치 20건에 90%, trip 85% — 그대로 두나, 바꾸나?
3. **하루 한도**: 하루 자동 ASSIGN 3건, AIRCRAFT당 1건, 하루 S3 작업 5건?
4. **RECALL**: 자동 배정 전에 `[DISPATCH D-xxxx] RECALL`을 만드나(제안), 아니면 되돌리기는 SUPERVISOR가 직접 보내는 메시지로 충분한가?
5. **S3 범위**: 빈 축의 CLASSIFY만(제안). 머지 뒤 `CLOSE`는 언제 검토하나?
6. **머지 슬롯**: vocado_nextjs는 1, atc는 제한 없음(제안). Urgent FLIGHT가 자기 저장소 대기열을 앞질러도 되나?
7. **LAND 제한 시간**: 30분?
8. **GROUND STOP 범위**: "main 깨짐"이 LAND도 멈추나(제안), 새 ASSIGN만 멈추나? 네 trigger 중 무엇을 먼저 `on`으로 하나?
9. **순서**: 1–5번(데이터와 그림자)을 지금 2a/S1과 나란히 만드나(제안)?
10. **스위치 위치**: 슬롯과 GROUND STOP은 따로 `atfm.json`에 두나(제안), 아니면 모두 `dispatch.json`에 두나?
