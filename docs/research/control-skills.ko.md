# 조사: 관제 세션의 일을 skill로

[English](control-skills.md) · **한국어**

> 상태(2026-10-01): 조사, 채택 전. [ATC-292](https://linear.app/vocado/issue/ATC-292/survey-control-session-work-as-skills-inventory-what-tower-occ-mcc)를 위해 썼다. 코드, 매뉴얼, guard, hook, 설정은 하나도 바꾸지 않았다. 6절의 후속 작업 지시서는 Linear에 만들지 않았다.

관련: [skill-rulebook.ko.md](skill-rulebook.ko.md)(ATC-281, 이 조사가 채우는 규정집의 모양), [control-context.ko.md](control-context.ko.md)(ATC-274, 관제 세션 컨텍스트를 무엇이 채우나), [control-recycle.md](../control-recycle.md), [safety-report.md](../safety-report.md), [watch.md](../watch.md).

## 질문

TOWER, OCC, MCC, CROSSCHECK, REVIEW, DUTY가 지금 하는 일마다 묻는다: skill로 바꿀까, 있는 skill에 더할까, 새 skill로 만들까, 서버 코드로 옮길까, 그대로 둘까? 답은 순위를 매긴 목록과 후속 작업 지시서다.

## 방법과 한계

- **`origin/main`에서 쟀다**(head `55c82a0`, 2026-10-01). 파일 크기는 한국어 원본(`*.md`)의 바이트와 글자 수다(`*.en.md`는 번역이라 읽히지 않는다). 토큰은 [control-context.ko.md](control-context.ko.md) 1절에서 잰 글자/토큰 비율을 쓴다: TOWER 2.0, OCC 1.7, MCC 1.8, CROSSCHECK 2.6, REVIEW 3.3. DUTY는 잰 비율이 없어(한국어가 많은 TOWER처럼 2.0으로 가정), `inspector.md`는 영어라 4로 가정했다.
- **인벤토리**는 읽기 전용 helper 에이전트 셋(Sonnet 5.5)이 역할 묶음마다 하나씩 했다. 매뉴얼을 제목이나 항목으로 쪼개 줄 범위의 바이트를 `awk`로 정확히 쟀다. 크기와 guard 사실은 내가 파일로 표본 확인했다. 표의 빈도는 2절이 재지 않은 것은 추정이다.
- **트랜스크립트.** 2026-09-26 .. 2026-10-01의 관제 세션 트랜스크립트 전부(계정 폴더 셋 `~/.claude`, `~/.claude-acct-1`, `~/.claude-acct-3`): TOWER 20개, OCC 17, MCC 19, CROSSCHECK 14, REVIEW 7, DUTY 6. 한 줄씩 흘려 읽었다. 남긴 것: 도구 이름, `atcctl` 서브커맨드 이름(`controller/atcctl.mjs`에 글자 그대로 있는 낱말만), Read한 매뉴얼·절차 파일의 파일명, `Skill` 이름, 오류 표시, 시각, user 턴의 **종류**(skill 본문이나 대기열 메시지 같은 구조로 정함). **메시지 본문과 명령 인자는 남기지도 인용하지도 않았다.** 틱은 전달된 `/tick` skill 본문 하나다. 다음 틱 전까지 모델의 도구 호출이 2번 이하면 **조용한** 틱, 3번 이상이면 **일한** 틱이다. control-context.md의 idle 정의(squelch와 요청 수)와 달라 수치가 조금 다르다.
- **하지 않은 것:** 선택 사항인 scratch 실험(OCC CLASSIFY를 `context: fork` skill로 vs 인라인). 이유: fork에 대한 답이 이 실험에 달려 있지 않고(4절 5번이 그 항목의 첫 단계로 둔다) OCC의 Agent 권한이 미확인이다. 비용: helper 에이전트 셋 합계 약 0.3 M 토큰(정가로 대략 1 USD, 추정), scratch 세션 없음.
- **공개 저장소:** 다른 AIRPORT의 내부와 메시지 본문은 없다.

## 1. 현재 사실: 인벤토리

### 1.1 역할마다 지고 있는 것

| 역할 | 파일 | 바이트 | 글자 | 토큰(추정) | 읽는 때 |
|---|---|---|---|---|---|
| TOWER | `controller/CLAUDE.md` | 14,427 | 9,482 | 4.7 k | 세션에 한 번 |
| TOWER | `controller/.claude/skills/tick/SKILL.md` | 1,730 | 1,147 | 0.6 k | **매 fire** |
| OCC | `occ/CLAUDE.md` | 19,878 | 12,838 | 7.6 k | 한 번 |
| OCC | `occ/.claude/skills/tick/SKILL.md` | 11,913 | 7,872 | 4.6 k | **매 fire** |
| OCC | `schedule.md` | 27,882 | 17,042 | 10.0 k | 필요할 때(실제로는 대부분의 세션) |
| OCC | `flight-plan.md` | 8,171 | 5,563 | 3.3 k | 필요할 때 |
| OCC | `following.md` | 5,470 | 3,534 | 2.1 k | 필요할 때 |
| OCC | `crew-change.md` | 3,905 | 2,731 | 1.6 k | 필요할 때(창 안에서 한 번도 안 읽힘) |
| OCC | `briefing.md` | 2,072 | 1,223 | 0.7 k | 필요할 때 |
| MCC | `mcc/CLAUDE.md` | 10,976 | 6,800 | 3.8 k | 한 번 |
| MCC | `mcc/.claude/skills/tick/SKILL.md` | 2,667 | 1,721 | 1.0 k | **매 fire** |
| MCC | `mcc/.claude/agents/inspector.md` | 4,551 | 4,545 | 약 1.1 k(영어) | PR마다 새 컨텍스트 |
| CROSSCHECK | `crosscheck/CLAUDE.md` | 11,914 | 7,672 | 3.0 k | 한 번 |
| CROSSCHECK | `crosscheck/.claude/skills/tick/SKILL.md` | 3,448 | 2,211 | 0.9 k | **매 fire** |
| REVIEW | `review/CLAUDE.md` | 6,165 | 3,820 | 1.2 k | 한 번 |
| REVIEW | `review/.claude/skills/tick/SKILL.md` | 1,794 | 1,114 | 0.3 k | **매 fire** |
| DUTY | `duty/CLAUDE.md` | 20,971 | 12,713 | 약 6.4 k(가정) | 근무마다 한 번(`/tick`도 skill도 없음) |

틱이 읽히는 방식: LAUNCH가 `/loop <n>m /tick`을 보낸다(TOWER 3분, MCC 5분, OCC·CROSSCHECK·REVIEW 10분. `server/session-control.ts`). fire마다 `/tick` skill 본문이 user 턴으로 온다. OCC의 `/tick` 본문은 그 단계에 할 일이 있을 때만 절차 파일을 열라고 하지만, `schedule.md`는 "최근 24시간 안에 TARGET·ROUTE 초안이 없음"이 트리거라 거의 늘 참이다. 그래서 27.9 KB 파일이 대부분의 세션에서 사실상 읽힌다.

### 1.2 절차 행과 판정 한눈에

| Role | Rows | memory | convert | add | create | fork | server | shared | leave | delete |
|---|---|---|---|---|---|---|---|---|---|---|
| TOWER | 30 | 4 | 1 | 2 | 0 | 0 | 14 | 3 | 1 | 5 |
| REVIEW | 18 | 2 | 1 | 5 | 0 | 0 | 1 | 3 | 4 | 2 |
| CROSSCHECK | 19 | 3 | 3 | 1 | 0 | 0 | 3 | 3 | 3 | 3 |
| MCC | 22 | 0 | 1 | 1 | 0 | 1 | 3 | 4 | 9 | 3 |
| DUTY | 17 | 0 | 3 | 0 | 0 | 0 | 0 | 3 | 11 | 0 |
| OCC | 43 | 6 | 6 | 6 | 2 | 6 | 4 | 3 | 4 | 6 |

행은 판정이 같은 절차(또는 절차 묶음)다. 각 행의 ID가 그 역할의 모든 절차를 덮는다(표는 3절). 판정 낱말은 이슈의 것이다: **memory**(`CLAUDE.md`에 남김), **convert**(skill로: `sop-`, `cl-`, `qrh-`), **add**(skill 안에), **create**(관찰한 패턴으로 새 skill), **fork**(새 컨텍스트), **server**(결정적 코드나 합성 `atcctl` 단계), **shared**(여러 역할이 한 글을), **leave**, **delete**.

### 1.3 guard가 허용하는 것(실현 가능성)

- **`Skill` 도구.** 어느 역할의 `settings.json`도 `Skill`을 막지도, 허용하지도, hook으로 걸지도 않는다. 사람이 없는 loop 세션에서 된다: 트랜스크립트에 `Skill` 호출 78번(`/tick` fire가 모두 하나씩)이 있고 `Skill` 오류는 없다. DUTY는 다르다: `--tools`, `duty/guard.mjs`의 `ALLOWED_TOOLS`, 설정 셋 모두 `Skill`이 없어서 DUTY는 skill을 열 수 없다(바꾸려면 세 곳이라 `user` 등급).
- **절차 파일 읽기.** OCC와 MCC는 저장소 안을 읽는다. REVIEW와 CROSSCHECK는 자기 폴더와 `../docs/`만 Read한다(`read-guard.mjs`). 맨 위 `rulebook/` 폴더는 이 둘에게 read-guard 변경이 필요하거나, `Skill` 도구를 거치는 plugin 배달(ATC-281의 `--plugin-dir`)이어야 한다. 후자는 guard를 바꿀 필요가 없다.
- **fork나 sub-agent.** REVIEW와 CROSSCHECK는 `Agent`·`Task`가 deny에 hook까지 막혀 있고, MCC는 `inspector`만 띄울 수 있다(`agent-guard.mjs`). TOWER와 OCC에는 `Agent` 차단이 없지만 fork를 띄울 수 있는지는 시험하지 않았다. fork는 구조화된 판정을 돌려주고 `atcctl` 쓰기는 부모가 해야 한다. guard가 Bash 명령을 못 박기 때문이다(MCC의 inspector로는 확인, 새 OCC fork는 미확인).
- **skill이 쓸 수 있는 명령**은 그 역할의 허용 목록이다: TOWER `atcctl`과 `jq`, OCC는 같은 것에 `gh pr view|checks|diff|list`, MCC `manual`, `mcc queue|packet|inspect|escalate|land|rts`, `gh` 읽기, CROSSCHECK `manual`, `crosscheck brief`, `dispatch brief|flight|crosscheck`, `schedule brief|crosscheck`, REVIEW `manual`, `landing queue|review`. 다른 명령이 필요한 skill은 guard 변경(`user` 등급)이 필요하다.
- **`manual check`가 덮는 것**은 `CLAUDE.md`, `tick/SKILL.md`, `.claude/skills/tick/` 안의 `.en`이 아닌 `*.md`다(`controller/atcctl.mjs`). 다른 폴더의 새 skill은 그 코드를 바꾸지 않으면 해시되지 않는다.

## 2. 관찰한 쓰임(트랜스크립트, 2026-09-26 .. 2026-10-01)

### 2.1 루프에서 일이 얼마나 되나

| 역할 | 요청 | 틱 | 일함 | 조용함 | 틱당 도구 호출(p50 / p90 / 최대) | idle 틱당 cache-read(control-context.md) | 조용한 틱의 cache-read(추정) |
|---|---|---|---|---|---|---|---|
| TOWER | 7,998 | 1,816 | 883 | **933 (51 %)** | 2 / 6 / 19 | 0.62 M | 0.58 G |
| OCC | 6,199 | 639 | 474 | 165 (26 %) | 5 / 13 / 54 | 0.92 M | 0.15 G |
| MCC | 3,973 | 717 | 266 | **451 (63 %)** | 2 / 7 / 31 | 0.33 M | 0.15 G |
| CROSSCHECK | 2,250 | 515 | 107 | **408 (79 %)** | 2 / 6 / 20 | 0.56 M | 0.23 G |
| REVIEW | 1,840 | 444 | 33 | **411 (93 %)** | 2 / 2 / 25 | 0.16 M | 0.07 G |
| DUTY | 18 | n/a | n/a | n/a | n/a | n/a | n/a |

닷새 동안 조용한 틱에서 cache-read된 토큰이 약 **1.2 G**다. 가장 흔한 틱 전체가 조용한 틱이다: TOWER `manual check > brief > ack` 600번(전체 틱의 33 %), OCC `manual check > dispatch brief > schedule brief > following > following ack` 132번, MCC `manual check > mcc queue > mcc land > mcc rts` 62번과 `… > mcc rts` 44번, CROSSCHECK `manual check > crosscheck brief > manual check` 24번, REVIEW `manual check > landing queue > landing review` 15번. 판단 없이 호출이 둘에서 다섯이다.

### 2.2 세션이 부르는 것

| 역할 | `atcctl` 서브커맨드 상위(호출 수) |
|---|---|
| TOWER | manual check 1,517 · ack 1,454 · brief 986 · issue 266 · readback 140 · roger 120 |
| OCC | manual check 592 · dispatch brief 523 · schedule brief 428 · following 339 · dispatch flight 273 · following ack 257 · dispatch release 242 · dispatch note 208 · dispatch readback 184 · dispatch report 115 · schedule draft 21 |
| MCC | mcc queue 632 · manual check 624 · mcc land 201 · mcc inspect 198 · mcc rts 129 · mcc packet 94 · (Agent, inspector, 148) |
| CROSSCHECK | manual check 519 · crosscheck brief 499 · dispatch flight 105 · dispatch crosscheck 69 |
| REVIEW | manual check 416 · landing queue 414 · landing review 255 |

`manual check`는 모든 역할에서 틱의 첫 호출이다(약 3,670번). `manual check > Read > manual ack` 순서는 TOWER에서 trigram으로 17번, CROSSCHECK에서 11번 나오고 OCC 등에도 틱 전체 일치가 있다: 모든 매뉴얼이 설명하는 "매뉴얼이 바뀌었다, 다시 읽고 ack한다" 절차다.

읽힌 절차 파일: OCC `CLAUDE.md` 37, `SKILL.md` 21, `flight-plan.md` 15, `schedule.md` 11, `following.md` 10, `briefing.md` 9, **`crew-change.md` 0**. 일과 견주면: `dispatch flight` 273번에 `flight-plan.md` 읽기 15번, `schedule brief` 428번, `schedule draft` 21번, 27.9 KB `schedule.md` 읽기 11번이다. 절차 파일은 이벤트마다가 아니라 세션 시작 때 훨씬 더 읽힌다. 세션은 순환을 컨텍스트에서 돌린다.

### 2.3 오류와 반복

| 명령 | 호출 | 오류 | 비율 |
|---|---|---|---|
| OCC `dispatch release` | 242 | 78 | **32 %** |
| OCC `dispatch arrived` | 26 | 11 | **42 %**(ATC-266이 `accepted`에서 `arrived`를 되게 하기 전) |
| OCC `dispatch flight` | 273 | 22 | 8 % |
| MCC `mcc inspect` | 198 | 29 | **15 %** |
| REVIEW `landing review` | 255 | 17 | 7 % |
| OCC `dispatch brief` | 523 | 11 | 2 % |
| MCC `mcc queue` | 632 | 10 | 2 % |
| TOWER `issue` | 266 | 4 | 2 % |

한 틱 안에서 같은 명령이 세 번 이어짐(재시도 후보): OCC `dispatch flight` 32틱, `dispatch release` 23, `dispatch readback` 20, `dispatch note` 18, `SendMessage` 21, TOWER `SendMessage` 21과 `issue` 14, MCC `Agent` 9와 `mcc packet` 8. (REVIEW의 28은 PR 여럿을 이어 리뷰한 것이지 재시도가 아니다.) 오류 글은 읽지 않아서 원인은 이 조사로 알 수 없다. SAFETY REPORT와 NEEDS YOU는 맞춰 보지 않았다: SAFETY REPORT는 기록이 없는 설계 초안이고 NEEDS YOU는 트랜스크립트에 없다.

### 2.4 종류별 user 턴(구조만)

| 역할 | 틱 fire | 대기열 peer 메시지 | 대기열 system | 그 밖의 user 턴(길이 p50) |
|---|---|---|---|---|
| TOWER | 1,816 | 34(AIRCRAFT 27) | 1 | 335(약 800자) |
| OCC | 639 | 53(모두 AIRCRAFT) | 0 | 366(약 1,350자) |
| MCC | 717 | 0 | 142(+기타 대기열 16) | 153(약 4,500) |
| CROSSCHECK | 515 | 0 | 0 | 25(약 6,100) |
| REVIEW | 444 | 0 | 0 | 12(약 7,900) |
| DUTY | 0 | 0 | 0 | 10(약 12자) |

"그 밖의" 턴은 SUPERVISOR가 친 것과 hook이 넣은 것을 구조로 나눌 수 없어서, "SUPERVISOR가 손으로 계속 시키는 일이 무엇인가"는 여기서 **개수로 답하지 못한다.** DUTY의 열 턴은 짧은 채팅이라 종류를 말해 주지 않는다. ATC-258이 사고에서 한 것처럼 SUPERVISOR 요청을 손으로 세면 답이 나오고, 이것이 작업 지시서 12다.

### 2.5 어느 매뉴얼도 하나의 절차로 이름 붙이지 않은 반복 패턴

worked 틱 안의 도구 이름 순서로 셌다(이름만):

1. **OCC FLIGHT PLAN 순환.** `dispatch flight > dispatch note > SendMessage > dispatch readback > dispatch report`(틱 전체 일치 8번), 조각으로 `dispatch release > SendMessage > dispatch readback` 28, `SendMessage > dispatch readback > dispatch report` 32, `dispatch note > dispatch release > SendMessage` 29. 매뉴얼은 이것을 답 종류별로 쪼갠다(`SKILL.md` 4단계, `flight-plan.md` 행, `CLAUDE.md` 송신 규칙). `success:false` 규칙은 세 파일에 되풀이된다. 순환을 멈춤 조건과 함께 한 절차로 보인 파일은 없다.
2. **TOWER CLEARANCE 순환.** `issue > SendMessage > ack` 184, 이어서 `roger` 93 또는 `readback` 82. 틱 전체 형태는 63 + 51 + 20 + 15. `CLAUDE.md`에는 조각(TWR-12, 30, 31)과 상황 표가 있고 순환은 없다.
3. **"매뉴얼이 바뀜" 다시 읽기.** 모든 역할의 `manual check > Read > manual ack`(TOWER와 CROSSCHECK trigram만 28번). 매뉴얼마다 설명한다. 서버가 할 수 있다.
4. **OCC release 거절.** 242번 중 오류 78번이고, 복구는 매뉴얼이 줄글 네 행(OCC-80..83)에 흩어 놓았다.
5. **PR 없는 FLIGHT 끝내기.** SURVEY·CHECK FLIGHT의 `dispatch report` 다음 `dispatch arrived`(`arrived` 26번, 오류 11번). ATC-266이 상태 기계를 바꾸지만 두 단계 절차는 두 곳에 적혀 있다.
6. **MCC inspect와 land 루프.** `mcc queue > Agent > mcc inspect > mcc queue > mcc land`(틱 전체 일치 16번과 14번). 매뉴얼이 이름 붙인다(틱 2·3단계). 이름 없는 관찰은 `mcc inspect` 문법 오류(15 %)와 `mcc packet` 반복이다.

## 3. 판정 표

절차마다 판정과 이유. 바이트는 줄 범위의 정확한 크기다. 분류: SOP 매 틱, CL 평소 체크리스트, COND 조건부 절차, ABN 비정상(QRH), LIM 이미 막힌 제한, BG 배경(FCOM). "T" 행은 `/tick` 본문이고, 나머지 ID는 매뉴얼 순서를 따른다. (표의 절차 설명은 기술 용어라 영어로 둔다.)

### 3.1 TOWER

| ID | 절차 | 바이트 | 분류 | 판정 | 이유 |
|---|---|---|---|---|---|
| TWR-01 | Role; reads RADAR, sends CLEARANCE; ask when unsure | 362 | BG | **memory** | 정체성과 매 턴 지켜야 할 한 줄(모르면 발행하지 않는다). |
| TWR-02 | No code; Bash only atcctl and jq; quoting and jq limits | 573 | LIM | **delete** | `guard.mjs`와 Edit/Write deny가 이미 막는다. 한 줄 포인터만. |
| TWR-03 | No writes to Linear, git, GitHub | 149 | LIM | **memory** | 전 역할 공통 한 줄(guard가 막는다. TOWER에는 mcp-guard가 없음, 미확인 참조). |
| TWR-04 | Do not judge in-worktree work | 216 | BG | **memory** | 짧은 범위 규칙. |
| TWR-05/06 | Tool table; CLEARANCE types | 1,065 | BG | **delete** | `atcctl` 도움말과 `issue`의 TYPE 검사가 있다. SendMessage는 세션 이름으로만 남긴다. |
| TWR-07 | SQUELCH note | 232 | BG | **delete** | 뒤따르는 행동이 없다. 다섯 역할에 같은 글이 있다. 지운다. |
| TWR-08 | Response attributes W/U/R; server rejects bad answers | 484 | BG+COND | **add** | `sop-replies`로. 거절은 서버가 하므로 '거절을 보고한다'만 남긴다. |
| TWR-09 | Loss of separation: first CONTINUE, rest HOLD | 298 | COND | **server** | 결정적이다. brief가 발행할 CLEARANCE를 그대로 줄 수 있다. |
| TWR-10 | Ground stop: no LAND, HOLD to holders, CONTINUE when ended | 636 | COND | **server** | 문구가 고정이다. 남는 판단이 없다. |
| TWR-11 | Merge slot: no LAND while slotHold | 451 | COND | **server** | `landingQueue`가 보류 PR을 빼면 된다. |
| TWR-12 | CLEARED TO LAND: LAND only if landBy is holder and no stop or slot; send landText verbatim | 1,082 | COND | **server** | 합성 단계가 `issue` 인자와 보낼 목록을 계산한다. 남는 것: holder가 없을 때 보고. |
| TWR-13 | APPROACH: no LAND; INFO from infoText on requested/blocked events | 794 | COND | **server** | 이벤트 중복 제거와 서버가 이미 쓰는 문구면 된다. |
| TWR-14 | GO AROUND: act on goAround.action; relay UNABLE | 1,068 | COND | **server** | `action`이 이미 계산된다. SUPERVISOR 보고 문구만 남긴다. |
| TWR-15 | Stacked PR: no LAND | 325 | COND | **delete** | TWR-13과 같다. |
| TWR-16 | STRANDED: report once to SUPERVISOR | 322 | COND | **server** | key 중복 제거. 판단은 문구뿐이다. |
| TWR-17 | Codex findings: all-P3 means send landText | 537 | BG | **delete** | landText·infoText가 이미 담는다. TWR-12/13과 중복. |
| TWR-18 | CODEX limit and REVIEW stand-in | 1,018 | COND | **add** | TWR-12 안의 한 줄과 `excluded` 보고 한 줄. |
| TWR-19 | github.error: LANDING SEQUENCE may be stale; report once | 124 | ABN | **server** | 서버가 이름 붙은 조건(`qrhOf`)으로 낼 수 있는 한 줄. |
| TWR-20/21 | handoff and OUTSTATION events: log only | 370 | COND | **server** | 서버가 자동으로 기록하면 된다. |
| TWR-22 | AIRCRAFT HEALTH: alert level once to SUPERVISOR, info logged, no message to team | 819 | ABN | **convert** | `qrh-health`. 남는 판단: 보고할 만한지. |
| TWR-23/24 | FUEL, FUEL LEAK, COLD CACHE: once per key | 1,320 | COND | **server** | 둘 다 같은 key 중복 제거. |
| TWR-25/26 | NORDO, UNIDENTIFIED, NO CONTACT: report new ones | 285 | ABN | **server** | key로 중복 제거. |
| TWR-27 | NO READBACK overdue 10 min: resend once with RESEND, then report | 209 | COND | **server** | 두 단계 모두 기계적이다. OCC overdue(OCC-75)와 모양이 같다. |
| TWR-28 | Team replies go to atcctl; free-form refusals to SUPERVISOR (tick step 1 repeats it) | 997 | SOP | **shared** | `sop-replies` 하나를 TOWER와 OCC가 같이 쓴다. |
| TWR-29 | alert.cleared: cancel the pending CLEARANCE | 107 | COND | **server** | 결정적이다. |
| TWR-30/31 | Send issue output verbatim; one CLEARANCE per message, two per team per tick | 219 | CL | **memory** | 보내면 되돌릴 수 없고 매번 필요하다. |
| TWR-32 | Use [ref] when the SendMessage name is ambiguous | 100 | COND | **leave** | 드물다. 한 줄. |
| TWR-33 | Language: English to sessions, Korean LOG | 350 | CL | **shared** | 공통 언어 규칙 한 줄. |
| TWR-34 | ATC LOG: one or two lines per tick | 199 | SOP | **shared** | 공통 LOG 한 줄. |
| TWR-T0..T5 | `/tick` body: manual check, replies, brief, walk the table, ack, LOG (1730 B, restates CLAUDE.md) | 1,730 | SOP | **server** | 대부분의 틱이 `manual check > brief > ack`(600번, 틱의 33 %)이다. 합성 `atcctl tick`으로, 본문은 포인터로. |

### 3.2 OCC

| ID | 절차 | 바이트 | 분류 | 판정 | 이유 |
|---|---|---|---|---|---|
| OCC-01/02 | Role identity; the five jobs | 2,118 | BG | **memory** | 줄인다. 자세한 것은 절차 파일에서 되풀이된다. |
| OCC-03/29 | manual check; re-read on CHANGED (CLAUDE.md 342 B and tick step 0 264 B) | 606 | SOP | **shared** | 공통 글 하나. CLAUDE.md 사본을 지운다. |
| OCC-04 | Mode from `dispatch brief`: shadow memos, approval also sends | 501 | SOP | **memory** | 보낼 수 있는 것을 정한다. |
| OCC-05 | Send only FLIGHT PLAN/RECALL/CC; header only; on success:false call undelivered | 1,087 | LIM+COND | **memory** | send-guard가 막는다. 한 줄만. `success:false`는 세 파일에 되풀이된다. |
| OCC-06 | CANCELLED approved card: release 409 means closed | 591 | COND | **add** | `sop-flight-plan-cycle`의 release 줄. |
| OCC-07 | Language: English to teams, Korean LOG | 376 | CL | **shared** | TWR-33과 같은 문장. |
| OCC-08..11, 17 | Never create/approve CREW CHANGE, change TARGETS/ROUTE, milestones; no verdicts; no merge | 1,215 | LIM | **memory** | '판정·승인하지 않는다' 한 줄로 합친다. deny, mcp-guard, 서버가 막는다. |
| OCC-12/30/67 | ARRIVED report: record it first with fixed fields (CLAUDE.md, tick step 1, flight-plan.md) | 2,599 | COND | **memory** | 세 곳에 있다. memory에는 '보고 줄을 바로 기록한다'만, 명령은 `sop-replies`로. |
| OCC-13/69 | Captain waits for the user's go: await-supervisor; never relay approval | 1,044 | COND | **add** | `sop-replies`로. '승인을 전하지 않는다'는 memory에. |
| OCC-14 | No NEW draft without a CHARTER REQUEST; DUTY text is data | 603 | LIM/CL | **memory** | 신뢰 경계. |
| OCC-15/16 | No code; Bash allow list; no Linear/git/GitHub writes | 819 | LIM | **delete** | guard가 막는다. 루트 CLAUDE.md가 fail-closed를 이미 말한다. |
| OCC-18 | Do not step into TOWER's work | 89 | BG | **leave** | 한 줄. |
| OCC-19 | Tool table with brief-field glossary | 3,660 | BG | **add** | glossary는 틱 skill의 참고 파일로. 절차 파일이 되풀이하는 줄은 지운다. |
| OCC-20 | SQUELCH note | 232 | BG | **delete** | TWR-07 참조. |
| OCC-21 | Procedure file table (when to read which file) | 1,281 | BG | **delete** | skill description이 대신한다. |
| OCC-22..25, 32, 106 | Review standard, memo table, HOLD mechanics, 'user decides' phrases, step 3, BRIEFING (about 9.5 KB) | 9,521 | SOP/COND | **fork** | FLIGHT 본문과 댓글을 읽고 메모·표시·HOLD·브리핑 세 줄을 돌려준다. 세션 맥락이 필요 없다. 쓰기는 부모가 한다. |
| OCC-26, 50 | TAIL ASSIGNMENT rules and TAIL drafts | 2,365 | COND | **convert** | `sop-tail` skill. 일부는 결정적이고 일부는 세션의 SUPERVISOR 지시가 필요하다. |
| OCC-27/44 | OCC LOG | 798 | SOP | **shared** | 공통 LOG. |
| OCC-28 | Tick frontmatter and 'read procedure files only when needed' | 727 | BG | **leave** | 포인터가 된다. |
| OCC-30 | Tick step 1: CAPTAIN replies and command mapping | 1,758 | SOP | **convert** | `sop-replies`. 대응표는 flight-plan.md·crew-change.md와 중복. |
| OCC-31 | Tick step 2: `dispatch brief`; verify arrivalCandidates evidence | 986 | SOP | **leave** | 포인터 틱에 남긴다. |
| OCC-33 | Tick step 4: release FLIGHT PLAN, RECALL, CC | 1,065 | COND | **create** | `sop-flight-plan-cycle`: release, 헤더만 전송, readback, report를 한 절차로(관찰된 5단계 순환). |
| OCC-34, 43, 89 | Tick steps 5 head and 7: `schedule brief`, `following` fresh issues | 1,233 | SOP | **server** | `following ack`가 매 틱 뒤따른다(161번). fresh가 없으면 서버가 ack하면 된다. |
| OCC-35, 39, 41 | Draft details: candidates, WAYPOINT, WAYPOINT gap | 2,153 | SOP/COND | **fork** | 아래 OCC-47..56과 함께. |
| OCC-36, 58..60 | CHARTER REQUEST and CHARTER DESK | 5,766 | COND | **create** | `sop-charter-desk`. `duty` 구역이 있을 때 이름으로 연다. 살아 있는 대화가 필요해서 fork가 아니다. |
| OCC-37, 38, 52 | WAYPOINT slips, ROUTE without WAYPOINT: report fresh, then ack | 1,183 | COND | **server** | `fresh`를 거르고 서버에서 ack한다. 남는 판단 없음. |
| OCC-40, 57 | TARGET/ROUTE drafts: once per 24 h; thresholds | 2,172 | SOP | **server** | 수치 기준은 atc가 검사한다. 모델에는 '근거가 분명한가'만 남는다. |
| OCC-42, 55 | S2 release: paste each CALL JSON into the Linear tool | 2,286 | COND | **convert** | approval 모드에서만. 길게는 서버의 복사 단계. |
| OCC-45, 62, 85, 91, 104 | File headers | 1,751 | BG | **leave** | skill description이 된다. |
| OCC-46, 63, 86, 92, 105 | Command tables inside the procedure files | 6,619 | BG | **add** | 맞는 skill로 나눈다. |
| OCC-47, 53 | Draft selection and CLASSIFY (reads fleet.md 4.1-4.3, up to 3 FLIGHTs) | 4,106 | SOP/COND | **fork** | 강한 fork: 입력이 크고 결과는 작다(type, wake, rating, priority와 사유). |
| OCC-48 | Axis table (summary of fleet.md 4) | 846 | BG | **delete** | 중복. schedule.md가 스스로 요약이라고 한다. |
| OCC-49 | CLOSE: gh pr view, only Fixes closes | 1,030 | COND | **fork** | PR과 본문을 읽고 초안이나 건너뜀을 돌려준다. |
| OCC-51, 56 | WAYPOINT attach and WAYPOINT gap | 4,568 | COND | **fork** | 기준과 FLIGHT 본문을 읽고 이름이나 비는 기준을 돌려준다. |
| OCC-54, 61 | Draft limits, error handling; command shape | 1,392 | NC | **add** | draft fork 안으로. |
| OCC-64..66, 68, 70..76 | FLIGHT PLAN reply rows: release, cold cache, readback, standby, arrived, recall, overdue, unable | 3,160 | COND/ABN | **add** | `sop-flight-plan-cycle`의 행으로(OCC-67, 69는 위의 중복). |
| OCC-77, 101 | send-guard blocked: do not retry, report | 249 | LIM | **delete** | 공통 memory 한 줄. send-guard가 막는다. |
| OCC-78, 79, 102 | success:false on FLIGHT PLAN, RECALL, CC | 1,153 | ABN | **convert** | `qrh-send-failed`(OCC-05 포함). |
| OCC-80..83 | release rejected: GROUND STOP, LAUNCHING/RESTARTING, no AIRCRAFT session, LAUNCH failed | 1,462 | ABN | **convert** | `qrh-release-refused`: 창 안에서 `dispatch release` 242번 중 78번(32 %)이 오류였다. |
| OCC-84, 87, 100 | Informational lines (DEPARTED, scope, `pending` means nothing) | 713 | BG | **delete** | 뒤따르는 행동이 없다. |
| OCC-88 | Issue-code table: what to report where | 3,179 | SOP | **server** | `following` JSON에 `report` 대상을 더한다. 남는 것: 문구와 에스컬레이션. |
| OCC-90 | On a report or request: check commit, checks, diff vs allowed scope | 730 | COND | **fork** | 입력(주장)이 작고 결과(사실 diff)도 작다. 또는 `cl-pr-check`. |
| OCC-93..99, 103 | crew-change.md: relay approved CC, waiting, readback, unable, standby, overdue, notes | 2,234 | COND/ABN | **convert** | `sop-crew-change`. 창 안에서 이 파일을 읽은 적이 0번이다(`crew-change brief` 56번). |

### 3.3 MCC

| ID | 절차 | 바이트 | 분류 | 판정 | 이유 |
|---|---|---|---|---|---|
| MCC-01 | Role and switch semantics (shadow, land, rts) | 1,109 | BG | **leave** | 짧은 배경. 끝 한 문장은 줄인다. |
| MCC-02 | No edit/SendMessage/Artifact; only the inspector as Agent; language | 445 | LIM | **leave** | settings deny, hook, `agent-guard.mjs`가 막는다. |
| MCC-03 | user-tier and ESCALATE'd PRs are not landed | 117 | LIM | **leave** | `mcc land`가 서버에서 다시 검사한다. |
| MCC-04/05/06 | No git/systemctl/gh write; no Linear writes; read scope is the repo | 510 | LIM | **leave** | guard 셋이 막는다. 공통 fail-closed 한 줄로 합친다. |
| MCC-07 | If a guard blocks, do not work around it; LOG it | 74 | LIM | **shared** | 네 곳에 같은 문장. |
| MCC-08 | Tool table | 1,653 | BG | **leave** | 명령 참고표. `mcc inspect` 문법은 검사 단계로. |
| MCC-09 | The four writes need the real model; standalone, single quotes | 377 | LIM+CL | **leave** | 모델은 guard가 막는다. 문법 팁은 검사 단계로(`mcc inspect`의 15 %가 오류). |
| MCC-10 | SQUELCH note | 232 | BG | **delete** | TWR-07 참조. |
| MCC-11/23 | INSPECTION procedure (CLAUDE.md 1395 B and tick step 2 1015 B, nearly word for word) | 2,410 | COND | **fork** | 이미 fork(inspector)다. 포인터 하나만 두고 두 번째 사본을 지운다. |
| MCC-12 | Inspector criteria (copy in CLAUDE.md, about 1850 B in inspector.md) | 1,761 | BG | **delete** | 주 세션은 쓰지 않는다. '둘을 같이 고친다'는 주석이 어긋남의 위험이다. inspector.md 사본만 둔다. |
| MCC-13 | Severity P0/P1/P2, finding line format | 398 | BG | **delete** | inspector.md에 중복. |
| MCC-14/24 | Land every PR with empty blocks; re-read the queue | 388 | CL | **server** | 결정적이다. '막힘 없는 PR 모두 착륙' 합성 단계. 남는 판단 없음. |
| MCC-15 | Flagged landing: LOG the changed control rules and side-effect files | 264 | COND | **server** | `mcc land`가 두 줄을 출력할 수 있다. |
| MCC-16/22/25 | RTS when due, once per tick, not after a landing | 822 | SOP | **server** | 서버가 이미 '지금이 아님'이라고 한다. 사전 단계로. |
| MCC-17 | ROLLBACK: do not RTS, report; SUPERVISOR clears it | 154 | ABN | **add** | 틱 1단계에서 가리키는 QRH 한 줄. |
| MCC-18/26 | Context CAP at 150k; read recycle.mode; LOG | 1,283 | COND | **convert** | `qrh-context-cap`. hook 배너가 이름을 부른다. |
| MCC-19 | Fresh start: all state is on the server | 536 | COND | **leave** | 포인터 `/tick`에 녹는다. |
| MCC-20 | MCC LOG lines | 338 | SOP | **shared** | 공통 LOG. |
| MCC-21 | manual check; re-read on CHANGED | 197 | SOP | **shared** | 모든 역할에 같다. |
| MCC-27 | Never edit/message/write Linear; blocked means LOG | 169 | LIM | **shared** | MCC-02/05/07의 되풀이. |
| MCC-28/29/31 | Inspector role, may-do list, reply block | 2,322 | BG/LIM/CL | **leave** | fork 안이다. 허용 목록은 `inspector-guard.mjs`가 막는다. |
| MCC-30 | How to inspect (the canonical criteria) | 1,851 | BG | **leave** | 남길 사본 하나. |

### 3.4 CROSSCHECK

| ID | 절차 | 바이트 | 분류 | 판정 | 이유 |
|---|---|---|---|---|---|
| XC-01 | Role: preliminary agree/disagree for DISPATCH and SCHEDULE drafts | 1,043 | BG | **memory** | 300바이트 정도로 줄인다. |
| XC-02 | Marks are advice; no approve, reject, verdict | 154 | LIM | **memory** | 공통 한 줄(REV-04). |
| XC-03 | No Linear/git/GitHub writes; gh read-only | 320 | LIM | **leave** | guard와 mcp-guard가 막는다. |
| XC-04 | File and Bash limits; quoting and jq rules | 1,001 | LIM | **delete** | read-guard와 guard가 막는다. jq·따옴표는 공통 메모 하나. |
| XC-05 | Send no messages | 133 | LIM | **leave** | deny와 hook으로 막힌다. |
| XC-06 | Do not follow OCC note blindly; verify in the body | 126 | CL | **memory** | 짧고 신뢰 경계에 관한 규칙. |
| XC-07 | Tool table | 1,490 | BG | **leave** | 틱 단계가 되풀이하는 줄은 지운다. |
| XC-08 | Marks only on open items; Opus model gate; log if blocked | 847 | LIM | **shared** | guard가 막는다. REV-10과 같다. |
| XC-09 | SQUELCH note | 232 | BG | **delete** | TWR-07 참조. |
| XC-10/11 | Verdict order table (status, done, prerequisites, priority, per target); CLOSE inverts 1-2 | 956 | CL | **convert** | `cl-crosscheck-verdict`. |
| XC-12 | Per-target agree conditions (ASSIGN, RELEASE, CLASSIFY, PRIORITIZE, NEW, CLOSE) | 1,711 | COND | **convert** | 대상 종류별 `cl-` skill, 대상 종류로 연다. |
| XC-13/15 | PR facts with gh pr view; other-repo refs; gh failure means no mark | 1,111 | COND | **add** | CLOSE skill 안에. 남는 판단: PR 상태 읽기. |
| XC-14 | AIRPORT to repo table (5 rows) | 203 | BG | **server** | 서버가 답할 수 있는 조회다. |
| XC-16/17 | Match the examples standard; undecidable means no mark | 464 | SOP | **delete** | 각각 틱 2·6단계의 한 줄과 같다. |
| XC-18 | Reason writing: one line, facts first; English terms, Korean text | 429 | CL | **shared** | 언어와 사유 형식. |
| XC-19/21 | Reason chips: a FLIGHT chip sends the proposal to PREFLIGHT HOLD; decide FLIGHT vs AIRCRAFT first | 864 | COND | **convert** | `cl-crosscheck-chips`. 결과를 되돌리기 어려워서 이름 붙은 체크리스트가 낫다. |
| XC-20 | Chip table (8 codes) | 640 | BG | **server** | 서버가 `--code`를 검사할 수 있다. 참고용으로 둔다. |
| XC-22 | CROSSCHECK LOG lines | 151 | SOP | **shared** | 공통 LOG. |
| XC-T0..T7 | `/tick` body (3448 B): brief, examples, per-pending marks, LOG | 3,448 | SOP | **server** | 틱의 79 %는 pending이 없다. 틱당 5건 상한과 TARGET/ROUTE 기준(fleet.md 7.4)이 여기에만 있다. |

### 3.5 REVIEW

| ID | 절차 | 바이트 | 분류 | 판정 | 이유 |
|---|---|---|---|---|---|
| REV-01 | Role: landing review when Codex is limited; unsure means do not pass | 685 | BG | **memory** | '모르면 통과시키지 않는다' 한 줄을 남긴다. |
| REV-02 | CROSSCHECK does DISPATCH/SCHEDULE, REVIEW only landing | 158 | BG | **delete** | REV-01에 합친다. |
| REV-03 | No Linear/git/GitHub writes; no gh; MCP read-only | 166 | LIM | **leave** | `guard.mjs --review`에 gh가 없고 mcp-guard가 읽기 전용이다. |
| REV-04 | No merge, approve, reject, verdict | 152 | LIM | **memory** | 공통 한 줄. |
| REV-05 | Send nobody a message | 133 | LIM | **leave** | SendMessage가 deny와 hook으로 막혀 있다. |
| REV-06/07 | File read limits; Bash only manual/landing/jq | 491 | LIM | **leave** | `read-guard.mjs`와 `guard.mjs --review`가 막는다. |
| REV-08 | Excluded PRs: do not touch; server returns 403 | 406 | COND | **add** | 리뷰 skill 1단계에 한 줄. |
| REV-09 | Tool table | 800 | BG | **leave** | 틱이 명령을 이미 보인다. |
| REV-10 | Record command only with the real Sonnet model; log if blocked | 470 | LIM | **shared** | guard가 막는다. '막힘을 기록한다'만 남긴다. XC-08과 같은 글. |
| REV-11 | SQUELCH note | 232 | BG | **delete** | TWR-07 참조. |
| REV-12 | Targets: only pending; excluded wait | 513 | CL | **add** | 리뷰 skill 1단계. |
| REV-13 | What to review; no style nits; security-looking diff without the flag is P0 | 481 | CL | **add** | `cl-landing-review` 체크리스트. |
| REV-14 | Security PR: extra scrutiny of GRANT/RLS/auth/migrations/secrets | 405 | COND | **convert** | `cl-security-pr`. `security` 표시가 있을 때만 연다. |
| REV-15/16 | Grading P0/P1/P2, one line per finding; truncated diff rule | 454 | CL | **add** | REV-13과 같은 skill. |
| REV-17 | Record: --head, 4000 chars, 409 means next tick; English text | 311 | CL | **shared** | 언어 부분은 공통. head와 409는 skill에. |
| REV-18 | At most 2 PRs per tick; no re-review of the same head | 102 | CL | **add** | 틱 2단계에 이미 있다. |
| REV-19 | REVIEW LOG lines | 156 | SOP | **shared** | 공통 LOG. |
| REV-T0..T4 | `/tick` body (1794 B): manual check, queue, review, record, LOG | 1,794 | SOP | **server** | 틱의 93 %가 `landing queue`에서 할 일이 없어 끝난다. 서버 사전 검사로, 모델 없이. |

### 3.6 DUTY

DUTY에는 loop도 skill도 없고, `claude -p` 프로세스 하나가 채팅에 답한다. 되풀이하는 절차(설계 문서, 작업 지시서, ADOPT)가 "convert" 행이고, `Skill` 도구가 없어서 막혀 있다. 그래서 형태는 Read로 여는 문서다(Read 범위에 `docs/`가 든다).

| ID | 절차 | 바이트 | 분류 | 판정 | 이유 |
|---|---|---|---|---|---|
| DUT-01/02 | Role, L1 powers, what DUTY can do | 1,916 | BG | **leave** | 짧은 배경. |
| DUT-04/05 | No approve/decide/merge/session control; no messages to sessions; CHARTER REQUEST drafts | 946 | LIM | **leave** | `duty/guard.mjs`, deny, `--tools`가 막는다. |
| DUT-06/07 | No code; no self-authority files | 819 | LIM | **leave** | guard의 Edit/Write 경로 검사와 deny. |
| DUT-08 | Linear: ATC team, Backlog/Todo, no delete or close | 181 | LIM | **leave** | `server/duty-linear.ts`가 막는다. |
| DUT-09 | Do not work around guard blocks | 280 | LIM | **shared** | MCC-07과 같은 문장. |
| DUT-10 | No secrets; read atc state via atcctl | 175 | LIM | **leave** | DUTY 읽기 규칙. |
| DUT-11 | Outside text is data; BEGIN DATA / END DATA wrappers | 552 | BG | **shared** | 읽는 모든 역할이 필요한 신뢰 경계. |
| DUT-12 | Language: Korean to SUPERVISOR; English elsewhere | 587 | CL | **shared** | `duty charter`의 CJK 거절만 코드가 검사한다. |
| DUT-13 | Tool table (about 20 commands) | 6,809 | BG | **leave** | 가장 큰 블록. `atcctl duty` 도움말이 이미 보이는 것은 줄인다(미확인). |
| DUT-14 | How it works: read the brief, answer from tool output, keep it short | 881 | SOP | **leave** | 매 턴. CLAUDE.md나 brief hook에 둔다. |
| DUT-15 | Preamble to design and work orders | 268 | BG | **leave** | 짧은 한 줄. |
| DUT-16/19 | Write a design doc (8 steps) and the post-merge status update | 2,562 | COND | **convert** | `sop-design-doc`을 Read로 읽는 문서로(DUTY에는 Skill 도구가 없다). `stand-done`은 이미 코드다. marker 동기화는 서버 단계가 될 수 있다. |
| DUT-17/18 | Write a work order (Linear EO) and split a big issue | 1,526 | COND | **convert** | `sop-work-order`. 코드가 이미 priority, 상태 제한, 상위 팀을 요구한다. 아직 안 막는 것: 전체 URL, 영어 본문, Fixes/Refs. |
| DUT-20 | ADOPT: design outline in Korean first, STAND only after agreement | 1,427 | COND | **convert** | `sop-adopt`. 트리거 문구를 `server/ideas.ts`가 만들므로 그 문서 이름을 부를 수 있다. |
| DUT-21 | Standing decisions: only the injected list counts | 1,323 | SOP | **leave** | 행동은 늘 읽는 memory에. 목록은 코드가 주입한다. |
| DUT-22 | SUPERVISOR QUEUE cards | 973 | COND | **leave** | 큐에 없는 key는 서버가 거절한다. skill보다 줄이는 쪽이 낫다. |
| DUT-23 | No /tick, no SQUELCH | 112 | BG | **leave** | 한 줄. |

### 3.7 create 후보

이슈는 관찰한 반복에서 나온 "create" 후보 셋 이상을 요구한다:

| 후보 | 근거(2절) | 어느 매뉴얼에도 없는 이유 | 판정 행 |
|---|---|---|---|
| `sop-flight-plan-cycle`(OCC): release, 헤더만 전송, readback, report와 멈춤 조건 | 2.5의 1; release 242번, flight 273번 | 매뉴얼이 답을 하나씩 설명한다 | OCC-33, OCC-64..76 |
| `sop-clearance-cycle`(TOWER): issue, 그대로 전송, ack, readback 또는 roger | 2.5의 2; issue 266번 | `CLAUDE.md`에는 상황이 있고 순환은 TWR-12, 30, 31과 틱 3단계에 흩어져 있다 | TWR-12, 30, 31 |
| `sop-replies`(TOWER와 OCC 공통): READBACK, ROGER, UNABLE, STANDBY, await-supervisor, ARRIVED | TOWER 140 + 120 + 11, OCC 184 + 115 | 두 역할에 거의 같은 글이 있다(TWR-28, OCC-12/13/30) | TWR-28, OCC-30 |
| `qrh-release-refused`와 `qrh-send-failed`(OCC) | 2.3: `release` 오류 32 % | 줄글 네 행과 `success:false` 사본 셋 | OCC-78..83 |

만들지 않은 것: 조용한 틱용 skill(서버 단계다. 4절 1번)과 DUTY의 패턴(DUTY 트랜스크립트가 너무 적어 반복을 못 본다. 후보는 매뉴얼에서 나왔다).

## 4. 순위 10

가치/노력 순이다. "측정"은 되었음을 보이는 것이다. 등급은 `deploy/landing-tier.mjs`를 따른다: 관제 폴더의 매뉴얼·CLI는 `flagged`, `rulebook/`과 guard는 `user`.

| # | 무엇 | 가치(근거) | 노력 | 등급 | 측정 |
|---|---|---|---|---|---|
| 1 | **서버의 조용한 틱 단락**: 역할마다(TOWER 먼저) 합성 `atcctl tick`이 `manual check`, brief, ack를 돌리고 brief에 할 일이 있을 때만 모델을 깨운다. SQUELCH fingerprint도 손본다. ATC-274 작업 지시서 3·10을 덮는다. | TOWER 틱 1,816개 중 51 % 조용, MCC 63 %, CROSSCHECK 79 %, REVIEW 93 %; 닷새에 cache-read 약 1.2 G | M | `flagged`(guard 변경이면 `user`) | 시간당 모델에 닿는 틱; 잘못 건너뛴 틱(brief에 할 일이 있었는데 건너뜀)이 shadow에서 0 |
| 2 | **역할마다 매뉴얼 PR 하나**: `/tick`을 포인터로, 중복을 지우고, guard가 막는 줄글을 지우고, 공통 줄은 memory 블록 하나로. ATC-274 작업 지시서 2와 ATC-281 작업 지시서 5를 합친다. OCC 먼저(`/tick` 본문이 성장의 39 %), 그다음 MCC, TOWER, CROSSCHECK, REVIEW. | OCC fire당 4.6 k 토큰; MCC는 검사 단계를 두 곳에, inspector 기준을 두 파일에 되풀이(약 2.2 KB); 매뉴얼 셋에만 공통 글 약 4 KB | 역할당 M | `flagged` | 늘 읽는 토큰(ATC-274 장부); 시간당 다시 주입되는 토큰 |
| 3 | **TOWER의 조건부 규칙을 서버가 계산해 `brief`에**(`landText`·`infoText`가 이미 그렇듯): TWR-09..27은 14.4 KB 중 약 9.1 KB이고 모두 결정적이다 | 5 k 토큰 매뉴얼이 절반쯤 준다; CLEARANCE 오류·누락이 준다 | L | `flagged` | 매뉴얼 크기; 매뉴얼을 다시 읽어야 했던 TOWER LOG 줄 |
| 4 | **`qrh-release-refused`와 `qrh-send-failed`**(OCC). 서버가 오류 코드로 이름을 부른다(ATC-288 `qrhOf`) | `dispatch release` 242번 중 78번 오류 | S(pilot skill 뒤) | `user`(`rulebook/`) | release 오류율; 거절 뒤 호출이 QRH를 따른 비율 |
| 5 | **OCC fork**: BRIEFING까지의 제안 검토(절차 약 9.5 KB)와 draft 계열 CLASSIFY, PRIORITIZE, CLOSE, WAYPOINT(schedule.md 27.9 KB). 이슈의 scratch 실험(최대 3 USD)부터 하고 OCC가 fork를 띄울 수 있는지 확인한다. | `schedule.md`는 대부분의 세션이 읽는데 draft는 21개만 썼다; fork는 읽은 것을 부모 밖에 둔다 | L | `flagged`(관제 폴더), guard·설정이 바뀌면 `user` | draft당 부모 컨텍스트 증가(인라인 대비); 기록한 표본에서 판정 일치 |
| 6 | **`sop-flight-plan-cycle`, `sop-clearance-cycle`, `sop-replies`** | 3.7: 순환이 수백 번 돌고 여러 곳에 흩어져 있다 | S~M | `user`(`rulebook/`) | 순환 명령의 재시도(3연속)와 오류율 |
| 7 | **공통 memory 블록**과 사본 삭제: SQUELCH 글(5곳), LOG 형식(6), 언어(4), manual check/ack(6), guard 막힘 규칙(4) | TOWER·REVIEW·CROSSCHECK에만 중복 약 4 KB, MCC·DUTY·OCC에 더 있다 | S | 루트 `CLAUDE.md`는 `user` | 중복 바이트(grep) |
| 8 | **MCC**: inspector 기준을 `CLAUDE.md`에서 지움; 합성 "막힘 없는 PR 모두 착륙, due면 RTS"; `mcc inspect` 기록 문법을 검사 단계로 | `mcc inspect` 호출의 15 % 오류; 기준을 두 곳에서 고침 | S~M | `flagged` | `mcc inspect` 오류율; MCC 매뉴얼 크기 |
| 9 | **DUTY 절차 문서**(`sop-design-doc`, `sop-work-order`, `sop-adopt`)를 Read로 읽게 하고, 코드가 검증할 수 있는 것은 서버 검사로: 전체 URL 참조, 영어 본문, `Fixes`와 `Refs` | DUTY는 지금 기억으로 쓴다; 코드는 priority와 상태는 보지만 이 셋은 안 본다 | M | 문서 `auto`; 검사 `flagged`; DUTY에 `Skill` 도구는 `user` | 리뷰 뒤 고쳐야 했던 작업 지시서 |
| 10 | **CROSSCHECK·REVIEW 체크리스트**(`cl-crosscheck-verdict`, `cl-crosscheck-chips`, `cl-landing-review`, `cl-security-pr`) | 양은 적지만(일한 틱 107, 33) FLIGHT chip은 제안을 PREFLIGHT HOLD로 보내 되돌리기 어렵다 | 각 S | `user`(`rulebook/`); REVIEW·CROSSCHECK는 plugin 길이 필요(read-guard) | 나중에 뒤집힌 disagree mark |

## 5. 작업 순서와 기존 계획과의 맞춤

규칙: **같은 파일을 두 번 고치지 않는다.** 관제 매뉴얼은 ATC-274 작업 지시서 2(포인터), 3(합성 틱), ATC-281 작업 지시서 5·8(memory 블록, ack)과 이 조사의 행이 모두 건드린다. 역할마다 매뉴얼 PR 하나가 포인터, 중복 정리, memory 블록, skill ID를 한꺼번에 하므로 ID가 생긴 뒤여야 한다.

1. **매뉴얼을 안 바꾸는 서버 단계.** 1번(합성 틱, SQUELCH)을 shadow 기간과 함께; TOWER의 서버 이동(3번)은 TOWER 매뉴얼 PR **앞에** 해서 그 PR이 한 번의 수정이 되게 한다.
2. **규정집 선행 작업**(ATC-281 작업 지시서 1~4): 등급 규칙(ATC-286, 리뷰 중), `qrhOf` shadow(ATC-288), Skill 호출 reader(ATC-289), pilot skill(ATC-290). pilot 묶음에 `qrh-release-refused`와 `qrh-send-failed`를 더한다.
3. **역할별 매뉴얼 PR** OCC, MCC, TOWER, CROSSCHECK, REVIEW 순, 각각 skill ID를 인용한다(2번). REVIEW와 CROSSCHECK는 먼저 배달을 마련한다: LAUNCH의 `--plugin-dir`(ATC-281 작업 지시서 7). read-guard가 `rulebook/`의 일반 Read를 막기 때문이다.
4. **새 skill**(3.7, 6번)은 같은 역할의 매뉴얼 PR과 함께.
5. **OCC fork**(5번)는 마지막: OCC 틱의 구조를 바꾸므로 scratch 실험을 먼저 하고 OCC 매뉴얼 PR은 한 번만 한다.
6. **DUTY**(9번)는 병행: `duty/`와 `docs/`만 건드린다.

**언어(D1).** skill 본문은 ATC-281이 정한 대로 영어다. 바뀐 절차의 사본은 `rulebook/`에 영어 **하나**뿐이고, SUPERVISOR용 한국어 요약은 `docs/guide/`에 가며, 빠진 문단의 `*.en.md` 번역도 같이 지운다. `CLAUDE.md`에 남는 것은 memory 블록과 포인터이고, memory 항목의 D1이 정해질 때까지 한국어 원본과 `*.en.md`를 둔다. 토큰: 한국어 파일은 글자 1.7~2.0개가 토큰 하나이고, 같은 절차는 영어가 보통 토큰이 적다. 옮겨 내는 절약 위에 더해지는 두 번째 절약이다(여기서는 재지 않음).

**SAFETY REPORT, CONTROL RECYCLE, WATCH.** SAFETY REPORT의 `rule`은 체크리스트 ID를 받으므로(ATC-281 작업 지시서 11) 새 skill마다 처음부터 안정된 ID가 필요하다. CONTROL RECYCLE 인계 브리핑(ATC-274 작업 지시서 5)은 글을 되풀이하지 말고 skill ID를 가리켜야 한다. WATCH(미래의 관제 역할)는 2번의 포인터 틱 패턴으로 시작하고 처음부터 도구 목록에 `Skill`이 있어야 한다. DUTY에는 그것이 없다.

## 6. 후속 작업 지시서(Linear에 만들지 않음)

| # | 제목 | 범위 | 예상 등급 |
|---|---|---|---|
| 1 | 합성 `atcctl tick`과 조용한 틱 단락, TOWER 먼저 | `controller/atcctl.mjs`, 서버 tick 뷰, SQUELCH fingerprint; would-skip 대 would-act shadow 기록; guard 허용 목록이 그 명령을 받는다 | `flagged`; guard가 바뀌면 `user` |
| 2 | TOWER 조건부 규칙을 `brief`로 | TWR-09..27(ground stop, slot, GO AROUND, FUEL, health, resend)의 서버 `brief` 칸, 테스트 | `flagged` |
| 3 | OCC 매뉴얼 PR: 포인터, 중복 정리, memory 블록, skill ID | `occ/CLAUDE.md`, `occ/.claude/skills/tick/*`(8번과 pilot skill 뒤) | `flagged` |
| 4 | MCC, TOWER, CROSSCHECK, REVIEW 매뉴얼 PR 각각 하나 | 그 역할의 `CLAUDE.md`와 `tick/SKILL.md` | `flagged` |
| 5 | `qrh-release-refused`, `qrh-send-failed` | `rulebook/skills/`; 영어; ATC-288 코드를 부른다 | `user` |
| 6 | `sop-flight-plan-cycle`, `sop-clearance-cycle`, `sop-replies` | `rulebook/skills/` | `user` |
| 7 | 루트·폴더 `CLAUDE.md`의 공통 memory 블록 | 4절 7번의 줄들 | `user`(루트 파일) |
| 8 | MCC: 합성 "막힘 없는 PR 모두 착륙, due면 RTS", `mcc land`가 flagged 착륙 LOG 줄을 출력, inspector 기준 사본 하나 | `controller/atcctl.mjs`, `server/mcc*.ts`, `mcc/CLAUDE.md` | `flagged` |
| 9 | 관제 세션 `--plugin-dir`와 REVIEW·CROSSCHECK의 read-guard 결정 | `server/session-control.ts`; plugin 길을 거절하면 read-guard | `flagged` / `user` |
| 10 | 조사 또는 실험: scratch에서 OCC fork(CLASSIFY, 검토와 BRIEFING)와 OCC가 그것을 띄울 수 있는지 | scratch 폴더, 가짜 `atcctl`, 최대 3 USD | `auto`(문서) |
| 11 | DUTY 절차 문서와 서버 검사 셋 | `docs/`(`sop-design-doc`, `sop-work-order`, `sop-adopt`), `server/duty-linear.ts` 검사 | 문서 `auto`, 검사 `flagged` |
| 12 | 조사: SUPERVISOR가 손으로 시키는 일을 종류별로 | ATC-258처럼 일주일 손으로 세기 | `auto`(문서) |
| 13 | CROSSCHECK·REVIEW 체크리스트 | `rulebook/skills/cl-*` | `user` |
| 14 | `manual check`가 `rulebook/`과 모든 skill 폴더를 덮음 | `controller/atcctl.mjs` `manualFiles()` | `flagged` |

## 7. 이 조사가 말하지 않는 것

- 2절이 잰 것 밖의 빈도는 추정이다. 표의 "rare"·"occasional"은 세지 않았다.
- 오류의 원인은 모른다(오류 글을 읽지 않았다). release 오류율 32 %에는 서버가 마땅히 거절한 경우가 섞여 있을 수 있다. skill의 가치는 오류를 모두 없애는 것이 아니라 다음 걸음에 이름을 붙이는 데 있다.
- 토큰 수치는 ATC-274의 글자/토큰 비율을 써서 거칠다. DUTY와 영어 `inspector.md`는 특히 그렇다.
- **미확인:** OCC나 TOWER에서 fork가 도는지; `/loop` fire가 `/tick` 본문 전체를 매번 다시 넣는지(ATC-274처럼 가정); TOWER의 Bash guard가 atcctl 서브커맨드를 제한하는지(플래그 없는 모드에 허용 목록이 안 보였다); TOWER에 MCP guard가 있는지; 지금 DISPATCH·SCHEDULE의 모드(`flight-plan.md`와 S2 행이 얼마나 살아 있는지를 정한다).
- DUTY의 패턴은 관찰하지 못했다(창 안에서 요청 18개). 후보는 매뉴얼과 서버 코드에서 나왔다.

## 출처

2026-10-01 `origin/main`의 `controller/`, `occ/`, `mcc/`, `crosscheck/`, `review/`, `duty/` 매뉴얼·skill·guard·설정; `server/session-control.ts`; `deploy/landing-tier.mjs`; [skill-rulebook.ko.md](skill-rulebook.ko.md); [control-context.ko.md](control-context.ko.md); 방법에 적은 관제 세션 트랜스크립트(개수만).
