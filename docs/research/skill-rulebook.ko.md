# 조사: skill을 atc의 규정집으로

[English](skill-rulebook.md) · **한국어**

> 상태: [ATC-281](https://linear.app/vocado/issue/ATC-281) SURVEY, 2026-10-01, Claude Code 2.1.286. 문서만 있다. 매뉴얼, skill, guard, hook, 설정, 세션은 하나도 바꾸지 않았다. 실제 세션에는 메시지를 보내거나 STOP, LAUNCH, compact하지 않았고 `~/.local/state/atc/`도 건드리지 않았다. 5장은 SUPERVISOR에게 드리는 권고이며 정해지거나 만들어진 것은 없다.

## 질문

atc는 항공의 말(CLEARANCE, READBACK, GO AROUND, NORDO)을 빌리지만 규칙 대부분은 세션이 탑승 때 한 번 읽는 산문이다: 루트와 폴더의 `CLAUDE.md`, CREW BRIEFING, skill 여섯 개. 항공은 매뉴얼을 *언제 쓰는가*로 나눈다. **atc는 skill을 규정집이자 대응 매뉴얼로, 곧 정해진 상황이 생기면 세션이 여는 이름 붙은 절차 묶음으로 만들어야 하는가? 만든다면 어떻게?**

## 방법과 한계

- **항공(1장)** 은 공개 문서에 대한 글쓴이의 지식으로 썼고, [ATC-258](lost-comms-and-contingency.ko.md)처럼 문서와 장 이름으로 댄다. 웹 페이지를 가져오지 않았고 ICAO 문서는 자유롭게 공개되지 않는다. **매뉴얼에 인용하기 전에 현재 판에서 확인한다.**
- **atc 사실(2장)** 은 `origin/main`의 `e5ebb70`에서 읽었다. 토큰은 [ATC-274](control-context.ko.md)에서 잰 비율을 쓴다(루트 `CLAUDE.md` 15.9 KB가 7.1 k 토큰, 곧 한국어 많은 이 파일들은 바이트당 약 0.44 토큰). 새로 잰 값이 아니라 추정이다.
- **Claude Code 동작(3장)** 은 2026-10-01에 도우미 에이전트가 요약형 가져오기 도구로 읽은 공식 문서와 4장의 scratch 실행에서 왔다. 정확한 숫자는 *전해 들은 대로*다.
- **참고 skill(1.2)**: 이슈에 적힌 공개 저장소 열한 곳을 clone해 모든 주장을 `HEAD`에서 확인했다. 모든 `HEAD`가 미리 읽은 commit과 같다(변한 것 없음). 표현이 다른 곳은 CHANGED로 표시했다.
- **실험**(4.2)은 scratch 폴더에서 가짜 절차와 가짜 `atcx` 명령으로, Haiku 4.5, 한 턴씩, 2회 반복했다. 표본이 작고, 모델 힘으로는 실제보다 쉬운 시험이다. 비율이 아니라 "기제가 작동하는가"로 읽는다.
- **비용.** 4.2의 scratch 실행 80회가 2.22 USD(`total_cost_usd` 합계). smoke 실행, plugin 확인, 목록 확인이 약 0.1 USD를 더한다. 도우미 에이전트 둘(합계 약 217 k 토큰)과 이 세션은 측정이 아니라 추정으로 합쳐 약 4~5 USD다(목표는 5).
- **공개 저장소.** 다른 AIRPORT는 일반적으로만 적었다. 대화 기록 글은 쓰지 않았고 스크린샷도 없다.

## 1. 항공의 매뉴얼 체계와 atc 대응

### 1.1 빌릴 것

| 항공 문서·장치 | 쓰임 | atc 지금 | 빈틈 |
|---|---|---|---|
| **Operations Manual** A(일반), B(기종 운항), C(항로·공항), D(훈련) (ICAO Annex 6 Part I의 운항교범 내용, EASA ORO.MLR.100, 14 CFR 121.133). 당국이 승인하고 **개정 서비스**, **임시 개정**, **유효 쪽 목록**으로 바꾼다 | 주인이 있고 승인된 한 벌의 규칙과 알려진 개정 | 루트 `CLAUDE.md`(일반), 관제 역할별 폴더 `CLAUDE.md`, `docs/`(항로·공항 사실) | 개정은 파일 해시(`atcctl manual check`, `rules-drift`)뿐. 개정 ID, 유효일, 임시 개정 없음 |
| **AFM 한계**(14 CFR 25.1581) | 조언이 아닌 하드 한계 | guard(`*guard*.mjs`, `hooks/kill-guard.mjs`): fail-closed 코드 | 코드인 게 맞다. 그대로 둔다 |
| **FCOM**(시스템과 *이유*), **FCTM**(기법) | 배경과 좋은 관행, 훈련과 의문일 때 읽음 | `docs/*.md` 설계 문서(불러오지 않음), 기법으로서 `atc-task` 절 | 문제없음: 자동으로 불러오지 않는다 |
| **SOP**와 **정상 체크리스트**(14 CFR 121.315, challenge-response 또는 flow 뒤 **do-verify**) | 비행마다 같은 순서, 짧게 | `atc-task` 0~8절, `/tick` 본문, CLAUDE.md "검증", "git과 PR" | 체크 항목이 긴 산문 속에 있음. "push 전", "도착 보고" 목록이 따로 없음 |
| **QRH** 비정상·비상 체크리스트(Boeing QRH, Airbus ECAM 조치): 조건문, 순서 있는 단계, **read-do**, 종료 상태("가까운 적합 공항에 착륙"), 경보가 울리면 연다 | 승무원이 고장 한가운데서 절차를 지어내지 않는다 | 이름 붙은 것 없음. GO AROUND는 CLAUDE.md "교신", RECALL·undelivered·overdue는 `occ/.claude/skills/tick/*.md`, NORDO는 `controller/CLAUDE.md`의 낱말 | 이 조사의 대상(2.2) |
| **Memory·recall item**(몇 단계는 외워서 하고 그다음 체크리스트) | 책을 펼 새가 없는 몇 초 | 이름 붙은 것 없음. 가장 가까운 것은 `CLAUDE.md` 안의 한 줄 규칙("`pkill` 금지", "READBACK 형식")과 guard | 선을 정한다(옵션 5) |
| **ECAM·EICAS**: 시스템이 고장 *과* 절차를 함께 보인다. 승무원이 QRH를 찾지 않는다 | 찾는 단계도, 어느 체크리스트인지 짐작도 없음 | brief가 코드(`undelivered`, `overdue`, `arrivalMissing`, FOLLOWING 이슈 코드, health `RESUME`·`STALLED`)를 이름 붙이고, NEEDS YOU와 BELL이 고장을 보인다 | 고장은 보이는데 절차 이름은 없다 |
| **MEL·CDL·MMEL**(14 CFR 91.213, Annex 6): 정해진 (O) 운항·(M) 정비 절차와 수리 기한 아래 고장난 채 출발 | 알려진 결함을 규칙대로 *안고 출발*, 다시 발견하지 않음 | AIRCRAFT의 AOG `until`·RETURN([fleet.md](../fleet.md) 8.6), 시험 서버의 `ATC_GITHUB=off` | "이 능력이 없다"(`gh` 없음, Codex 한도, 검토 레인 중단)의 절차 없음 |
| **Position relief briefing** 체크리스트 | 떠나는 position이 열린 항목을 넘김 | `restartSafetyOf`, `schedule wip`, ATC-258 F8 | 별도 작업, [ATC-258](lost-comms-and-contingency.ko.md) 7장 |
| **체크리스트 철학**(Degani·Wiener, NASA CR-177549, 1990 "The Normal Checklist", 그리고 "Cockpit checklists: concepts, design, and use", Human Factors, 1993) | 짧게, 작업 순서대로, 확인할 수 있는 항목, 적은 수, 주인 | — | 5장 형식에 적용 |

atc에 옮겨 올 세 가지:

1. **매뉴얼은 쓰는 때로 나뉜다.** 비정상 매뉴얼은 미리 읽는 것이 아니라 *사건이* 연다.
2. **QRH 항목은 모양이 정해져 있다**: 조건, 순서 있는 단계, 종료 상태, 보고할 것. 승무원은 따르지 해석하지 않는다.
3. **시스템이 절차를 이름 붙인다**(ECAM). 경보가 울리는 동안 맞는 책을 찾으라고 하지 않는다.

### 1.2 참고 skill, 지금 commit에서 확인

모든 `HEAD`가 미리 읽은 commit과 같다. skill 수는 `SKILL.md` 파일 수다.

| 출처(commit) | 확인한 것 | 정정·추가 | atc에 쓸 것 |
|---|---|---|---|
| [mattpocock/skills](https://github.com/mattpocock/skills) (`d81f3a1`, MIT, 36개, `skills/in-progress` 밖 30개) | `.agents/invocation.md`("Model-invoked vs user-invoked": 사용자 호출은 사람이 읽는 설명, 모델 호출은 "Use when…" 트리거 유지), `skills/engineering/diagnosing-bugs/SKILL.md`의 Phase 1~6과 "Do not proceed until you have reproduced and minimised", `ask-matt`는 라우터이며 스스로 사용자 호출(`disable-model-invocation: true`), `Call the Skill tool with "X"` 관례, `skills/misc/git-guardrails-claude-code`는 `exit 2`하는 `PreToolUse` hook, `.changeset/`(대기 14), `.agents/adr/`(2), `.out-of-scope/`(3), `skills/productivity/writing-for-agents` | 사용자 호출 skill은 다른 skill이 부를 수 없다. 필요한 단계는 사람에게 실행하라고 말해야 한다. 실제 버전 관리(changeset과 `CHANGELOG.md`)가 있는 둘 중 하나(다른 하나는 noodle) | 개정 흔적과 "기각한 절차" 기억(`.out-of-scope/`), 하드 한계는 hook, "done when"이 있는 단계 관문 |
| [poteto/noodle](https://github.com/poteto/noodle) (`82d2921`, MIT) | `schedule:` frontmatter가 skill이 *언제* 도는지 말함(`.agents/skills/schedule/SKILL.md`), `stage_message` `blocking: true`(또는 생략)는 loop의 자동 진행을 멈추고 `false`는 진행하며 메시지는 전달(`.agents/skills/quality/references/stage-message-schema.md`), `.agents/skills`에 29개 | `skills/`와 `examples/`까지 세면 약 36개. `CHANGELOG.md`와 `VERSION` 있음 | 내용과 분리된 트리거, 종료 상태로서의 blocking 판정 |
| [poteto/brainmaxxing](https://github.com/poteto/brainmaxxing) (`ec4d8e4`, MIT, 6개) | `reflect → ruminate → meditate`, `brain/principles.md`가 `encode-lessons-in-structure`에 링크, meditate가 읽기 전용 Auditor 다음 Reviewer를 돌림("All agents are read-only") | 버전 관리 없음 | 교훈은 구조로, 규칙을 바꾸기 전 읽기 전용 검토(SAFETY REPORT와 비교, [safety-report.md](../safety-report.md)) |
| [poteto/verification-skill-example](https://github.com/poteto/verification-skill-example) (`d5abe70`) | `.cursor/skills/verify-atlas/references/features/` 아래 기능별 파일(약 35개)과 색인 `README.md` | **CHANGED**: 네 제목은 `Sub-features`, `How to get to it (user POV)`, `Driving it with control-atlas`, `Gotchas`(원문의 "How to reach / drive it"이 아님) | 고정 제목과 훑는 순서로 쓰는 색인 |
| [poteto/how](https://github.com/poteto/how) (`b1ef429`) | 코드베이스에서 어떤 것이 어떻게 도는지 설명하는 skill 하나 | — | 없음 |
| [humanlayer/humanlayer](https://github.com/humanlayer/humanlayer) (`99abe67`, Apache-2.0, `.claude/`에 command 27개·agent 6개, skill 0개) | `create_plan`은 phase마다 "Automated Verification"과 "Manual Verification"과 사람 확인 멈춤, `implement_plan`은 "STOP and think deeply" 뒤 "Expected / Found / Why this matters", `create_handoff`는 고정 frontmatter 칸, `resume_handoff`는 "Never assume handoff state matches current state", `codebase-analyzer`는 `file:line` 요구, `codebase-locator`는 경로만 돌려줌 | — | 받는 쪽이 확인하는 고정 칸 handoff, 불일치 때 멈춤 블록 |
| [humanlayer/skills](https://github.com/humanlayer/skills) (`ca7c808`, MIT, plugin 6개), [advanced-context-engineering-for-coding-agents](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents) (`f2bc7ae`), [rpi-coordination-template](https://github.com/humanlayer/rpi-coordination-template) (`90a4e7b`), [dexhorthy/slopfiles](https://github.com/dexhorthy/slopfiles) (`f7a350a`, MIT, 3개) | 컨텍스트 사용률 40~60 % 목표, `improve-claude-md`의 `<important if="condition">` 블록, 배포는 `.claude-plugin/marketplace.json` | 템플릿 README가 Workspaces 기능이 대체할 수 있다고 경고 | 메모리 파일 안의 조건 블록, 배포 형태로서 plugin marketplace |
| [emilkowalski/skills](https://github.com/emilkowalski/skills) (`d16ebe6`, MIT, 14개) | `animate`와 `review-animations`가 "Initial Response"·"Operating Posture"를 공유, 검토자가 "Default to flagging; approval is earned"와 Block/Approve 판정, 같은 easing·duration 표가 skill 다섯 개 이상에 반복, 버전·소유자 메타데이터 없음 | **CHANGED**: `STANDARDS.md`는 검토자만 인용(만드는 쪽은 자기 표와 `RECIPES.md`), `improve-animations`는 "zero context" 모델이 계획을 실행할 수 있어야 한다고 하지만 **글자 그대로의 "STOP and report"는 없다**(사용자가 지적을 고를 때까지 멈추라고 함) | 반례: 복사한 표는 어긋난다 |

**MEL 빈틈 확인.** 열한 저장소 어디에도 도구가 없거나 능력이 줄었을 때 일하는 절차 skill은 없다. 가장 가까운 것도 skill 하나 안의 fallback이다. atc가 MEL을 직접 설계해야 한다(옵션 6).

**atc에 견줄 패턴**(결정은 5장): 설명이 트리거이고 본문은 필요할 때 불러온다. 호출 방식은 안전 선택이며 하드 한계는 hook과 코드에 둔다. 단계는 "done when"과 불일치 때 멈춤으로 끝난다. 개정 흔적이 있는 단일 출처 문구. 교훈은 구조로. handoff는 받는 쪽이 확인하는 고정 칸. **피할 것**: skill 난립(noodle 29, Pocock 30), 에이전트가 자기 절차를 다시 쓰기, "사람을 절대 막지 않기"(TOWER·OCC에는 틀림).

## 2. atc 지금

### 2.1 규칙 목록과 불러오는 비용

크기는 한국어 원본의 바이트다(`*.en.md` 번역은 불러오지 않는다). 토큰은 바이트당 0.44(ATC-274가 잰 루트 7.1 k, TOWER 6.4 k, OCC 8.4 k).

| 출처 | 크기 | ≈ 토큰 | 불러오는 때 | 어떤 규칙 |
|---|---|---|---|---|
| 루트 `CLAUDE.md` | 15.9 KB | 7.1 k(측정) | **항상**, 저장소에서 시작한 모든 세션(atc에서 일하는 AIRCRAFT, 관제 폴더, DUTY) | SOP(작업 위치, git·PR, 언어, 용어), 정상 체크리스트("검증"), 한계("운영": 운영 재시작 금지, `pkill`), GO AROUND 절차와 READBACK 형식("교신"), 배경("코드") |
| `controller/CLAUDE.md`(TOWER) | 14.4 KB | 6.4 k(측정) | 그 폴더에서 항상 | 역할, 도구, 판단 기준, 메시지 |
| `occ/CLAUDE.md` | 19.9 KB | 8.4 k(측정) | 항상 | 역할, 검토 기준, TAIL ASSIGNMENT, 절차 파일 목록 |
| `mcc/` · `crosscheck/` · `review/` · `duty/`의 `CLAUDE.md` | 11.0 · 11.9 · 6.2 · 21.0 KB | ≈ 4.8 k · 5.2 k · 2.7 k · 9.2 k | 그 폴더에서 항상 | 같은 모양 |
| 관제 역할별 `/tick` `SKILL.md` | OCC 11.9 KB, MCC 2.7, CROSSCHECK 3.4, REVIEW 1.8, TOWER 1.7 | tick당 측정(ATC-274): OCC ≈ 3,200, MCC ≈ 870, CROSSCHECK ≈ 770, TOWER ≈ 440, REVIEW ≈ 310 | **`/loop` tick마다 본문을 다시 보냄**(ATC-274 대화 기록) | loop의 SOP와 정상 체크리스트 |
| OCC 절차 파일 `occ/.claude/skills/tick/*.md` | 모두 47.5 KB(`schedule.md` 27.9, `flight-plan.md` 8.2, `following.md` 5.5, `crew-change.md` 3.9, `briefing.md` 2.1) | 모두 읽으면 ≈ 21 k | **필요할 때**: 그 단계에 할 일이 있을 때만 읽음(SKILL.md 단계 글) | atc에서 QRH·FCTM에 가장 가까운 것. 상황별이 아니라 단계별 |
| `.claude/skills/atc-task/SKILL.md` | 10.8 KB | ≈ 4.7 k | 세션이 ATC 이슈를 맡을 때(모델 호출 또는 `/`) | 팀 세션의 SOP + 정상 체크리스트(0~8절) |
| CREW BRIEFING(`server/fleet.ts`의 `crewBriefing`) | 약 2.4 KB | ≈ 0.6 k | LAUNCH 때 한 번 붙여 넣음(`claude --bg … <briefing>`, `server/session-control.ts`) | 정체, 구성, 언어, STAND 문단, 답장 주소 |
| guard와 hook | 코드 | 0 | harness가 돌림, 읽지 않음 | 한계(fail-closed), `rules-drift` 알림 |
| `docs/*.md` | 큼 | 0 | 자동으로 불러오지 않음 | FCOM 같은 배경 |

두 숫자가 중요하다. 세션이 **늘** 지니는 규칙: 7.1 k(루트)에 폴더 파일(2.7~9.2 k)을 더한 약 10~16 k이고, 그 위에 ATC-274 1.1이 나누지 못한 목록·plugin 컨텍스트 약 20 k가 있다. **tick마다** 다시 보내는 규칙: OCC는 시간당 최대 18.5 k 토큰. 상황별 규칙은 모두 이 늘 불러오는 파일 안에 있거나 단계 글 속에 묻혀 있다.

### 2.2 비정상 상황: 지금 절차가 있는가, 세션이 찾았는가

2026-10-01의 사건 여섯 개는 [ATC-258](lost-comms-and-contingency.ko.md) 1장(I1~I6)이다. SAFETY REPORT 종류는 [safety-report.md](../safety-report.md) 3.1(`false-block`, `guard-block`, `ambiguous-rule`, `repeat-ask`, `no-rule`은 S0에서 뺌). "찾은 쪽"은 ATC-258과 SAFETY REPORT 초안에서 본, 세션이 알아챘는지 SUPERVISOR가 알아챘는지다. 둘 다 말하지 않는 곳은 **측정하지 않음**이다. 세션이 절차를 *열었는지*는 기록이 없다. 열 것이 없었기 때문이다.

| 상황 | 지금 절차(어디) | 찾은 쪽 | 제안 |
|---|---|---|---|
| I1 OCC가 다른 ACCOUNT의 AIRCRAFT에 닿지 못함, 계획과 RECALL 미발송 | `occ/.claude/skills/tick/flight-plan.md`의 `dispatch undelivered`와 CAUTION. *AIRCRAFT* 쪽 규칙 없음 | SUPERVISOR | `qrh-undelivered`(OCC), `qrh-lost-comms`(AIRCRAFT) |
| I2 APPLY NOW는 발송을, 발송은 OCC를 기다림(교착) | 없음, 설계 규칙(ATC-258 F11) | SUPERVISOR | 체크리스트가 아니라 설계 검토 규칙 |
| I3 백그라운드 AIRCRAFT가 권한 프롬프트에서 멈춤 | CREW BRIEFING의 STAND 문단, `CLAUDE.md` "작업 위치"(예방만, ATC-252). 이미 멈춘 팀이나 그것을 읽는 TOWER의 절차는 없음 | SUPERVISOR | `qrh-stalled` |
| I4 `ARRIVED` 보고했는데 OCC가 기록 전에 끝남 | tick 1단계("읽는 즉시 기록", ATC-169), `arrivalMissing` | SUPERVISOR | `cl-arrived`(정상), `qrh-arrival-missing` |
| I5 호스트 재부팅, "Cannot fork", 복구 순서가 적혀 있지 않음 | 없음(ATC-258 F9) | SUPERVISOR | `qrh-atc-zero`(비상 계획 설계 뒤) |
| I6 낡은 block, fix가 이미 착륙한 이슈를 배정, 아직 LAUNCH 안 된 STAND에 NORDO | `controller/CLAUDE.md`(낱말로서 NORDO) | SUPERVISOR | 서버 수정(F5, F6, F7). 매뉴얼이 여전히 오해를 부를 때만 `qrh-stale-block` |
| GO AROUND | `CLAUDE.md` "교신"(순서가 있는 유일한 전체 절차)과 `atc-task` | 세션(CLEARANCE라서) | `qrh-go-around`, 그대로 옮김 |
| RECALL / NO READBACK overdue | `flight-plan.md`(OCC), `CLAUDE.md` "교신"(팀) | 측정하지 않음 | `qrh-no-readback`(OCC), `qrh-recall`(팀) |
| NORDO(죽은 세션) | `controller/CLAUDE.md`(orphan을 셈), [fleet.md](../fleet.md) 8.6 | 측정하지 않음 | TOWER용 `qrh-nordo` |
| `pkill` 사고(ATC-134, 2026-09-29) | `CLAUDE.md` "검증" + `hooks/kill-guard.mjs`(hook) | SUPERVISOR(장애) | memory item + guard로 남김(옵션 5) |
| LIMIT / RESUME / rate limit | `following.md`, `schedule.md`(OCC가 초안을 그만 씀), health `RESUME` 코드 | 측정하지 않음 | `qrh-usage-limit`(팀과 OCC) |
| BLOCKED 기다림 | `CLAUDE.md` 교신 최종 보고 줄 `BLOCKED …`, `mcc/CLAUDE.md` | 측정하지 않음 | `qrh-stalled`에 합침 |
| SAFETY REPORT `false-block`(orphan claim만 남았는데 TOWER가 BLOCKED) | `controller/CLAUDE.md` 판단 기준 | SUPERVISOR(배지) | 규칙 수정. 보고의 `rule` 칸이 체크리스트 ID를 가짐 |
| SAFETY REPORT `guard-block`, `ambiguous-rule`(PR #244 등급 불일치), `repeat-ask` | 불평 대상이 된 그 매뉴얼 | SUPERVISOR | `rule` = 체크리스트 ID와 개정. 절차가 생기면 `no-rule` 추가 |
| 능력 없음(`gh` 없음, Codex 한도, 검토 레인 중단) | AIRCRAFT의 AOG뿐 | 측정하지 않음 | `mel-*` skill(옵션 6) |

표를 읽으면: 15행 중 **하나**(GO AROUND)만 필요한 세션을 위한 순서 있는 전체 절차가 있고, ATC-258은 여섯 사건이 모두 SUPERVISOR가 찾았다고 기록한다. ATC-258의 발견을 되풀이하면서 원인을 보탠다: 있는 절차도 *늘 불러오는 파일 속이나 단계 글 속에* 있어서, 사건 한가운데의 세션이 어느 문단을 기억해야 하는지 알아야 한다.

### 2.3 다른 AIRPORT의 AIRCRAFT에 규칙이 어떻게 닿는가

- 백그라운드 AIRCRAFT는 AIRPORT 자기 저장소 폴더에서 `claude --bg -n <REG> --permission-mode … <CREW BRIEFING>`으로 뜬다(`server/session-control.ts`). **그 저장소의** `CLAUDE.md`와 `.claude/skills`를 읽고 atc의 것은 읽지 않는다. atc의 `CLAUDE.md`와 `atc-task`는 따라가지 않는다.
- 따라가는 것은 약 2.4 KB 붙여 넣기 글인 CREW BRIEFING이다: 정체, 구성, 언어, 답장 주소, 그리고 (백그라운드 세션에는) 규칙이 atc의 `CLAUDE.md`에만 있었기 *때문에* 생긴 STAND 문단([ATC-252](https://linear.app/vocado/issue/ATC-252)).
- `rules-drift`는 `CLAUDE.md`와 `AGENTS.md`(`DEFAULT_FILES`, 옵션 `--files`)를, `atcctl manual check`는 관제 폴더의 `CLAUDE.md`, `SKILL.md`, tick 절차 파일을 해시한다. 그 목록 밖의 skill은 어느 쪽도 보지 않는다.

그래서 AIRPORT를 넘는 규칙은 briefing에 붙여 넣어(그래서 briefing이 커지거나) 아예 없다. skill 묶음은 그 AIRCRAFT에게 저장소를 건드리지 않고 규정집을 주는 방법이다.

## 3. Claude Code 동작(2.1.286)

출처: 2026-10-01에 요약형 도구로 읽은 공식 문서(S = skills 쪽, H = hooks, L = plugin 로딩, P = plugins 참고)와 4장의 scratch 실행. **V** 확인됨, **U** 미확인 또는 문서에 없음.

| 주제 | 내용 |
|---|---|
| **V** skill당 컨텍스트 | 이름, 설명, `when_to_use`는 늘 컨텍스트에 있고 skill당 1,536자로 제한. 본문은 호출할 때 불러오고 곁 파일은 읽을 때만 불러온다.(S) |
| **V** 목록 예산 | 목록 전체의 예산은 모델 컨텍스트 창의 1 %(`skillListingBudgetFraction`, 또는 `SLASH_COMMAND_TOOL_CHAR_BUDGET`). 넘으면 **설명이 쓰임이 적은 skill부터 빠지고 이름은 남으며** 이름으로 호출할 수 있다.(S) |
| **V** scratch 실행 | 프로젝트 skill 8개일 때는 설명이 보였다. 프로젝트 skill 88개(절차 8개와 닮은 미끼 80개)일 때 모델은 **모든 프로젝트 skill이 설명 없이 이름만** 보인다고 답했고, 일부 번들 skill은 설명을 유지했다(모델이 자기 컨텍스트를 설명한 것이며 예산 규칙과 맞는다). 결과는 4.2에서 잰다. |
| **V** 호출 | 설명으로 모델 자동 호출, 명시적 `/name`, 이름으로 `Skill` 도구 호출. `disable-model-invocation: true`는 사용자 전용, `user-invocable: false`는 메뉴에서 숨김. 그 밖의 frontmatter: `allowed-tools`, `disallowed-tools`, `model`, `effort`, `agent`와 함께 `context: fork`, `hooks`, `paths`, `argument-hint`, `arguments`, `when_to_use`, `shell`, `metadata`, `license`, `compatibility`. 설정 `skillOverrides`.(S) |
| **V** 한 번 호출한 뒤 | 본문이 메시지 하나로 들어와 이후 턴에 남는다. 렌더링 내용이 같은 재호출은 짧은 메모만 붙고 다르면 다시 붙는다. 자동 compaction은 skill마다 가장 최근 호출을 다시 붙인다: skill당 처음 5,000 토큰, 합계 25,000 토큰.(S) |
| **U** `/loop` 재주입 | 문서는 loop를 말하지 않는다. [ATC-274](control-context.ko.md)는 `/tick` 본문이 fire마다 다시 쓰인다고 잰 바 있고 그 측정이 유효하다. 이 조사는 다시 시험하지 않았다. |
| **V** 배포 | 우선순위: enterprise, 개인(`~/.claude/skills`), 프로젝트(`.claude/skills`). plugin skill은 `/plugin:skill`로 이름공간이 나뉜다. 프로젝트 skill은 작업 폴더가 다른 저장소인 세션에 **닿지 않는다**. 로컬 디렉터리에서 불러온 plugin은 세션 시작마다 그 자리에서 읽는다. marketplace plugin은 버전(manifest `version`, 없으면 commit SHA)으로 캐시되고 **타사 marketplace는 자동 업데이트가 기본 꺼짐**이며, 돌고 있는 세션은 `/reload-plugins` 전까지 옛 버전을 쓴다. 개인·프로젝트 `SKILL.md` 수정은 세션 도중에도 반영된다.(S, L, P) |
| **V** hook | `additionalContext`를 `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse` 등이 줄 수 있고 10,000자 제한. `FileChanged`, `ConfigChange`(matcher에 `skills` 포함), `InstructionsLoaded`가 있다.(H) **U**: `SKILL.md` 하나를 고쳤을 때 `ConfigChange`의 정확한 payload. |
| **U** 서버 글이 skill을 부름 | 사용자 메시지나 hook 글이 skill 이름을 대면 모델이 `Skill`을 부른다는 보장은 문서에 없다. 4.2가 쟀다: 16/16과 16/16. |
| **V** plugin 디렉터리(scratch) | skill이 없는 작업 폴더에서 `claude -p --plugin-dir <dir>`이 plugin의 skill을 `atc-rulebook:` 이름공간으로 불러왔고, `Skill` 도구가 경보 글의 평범한 이름을 받아 주었다. |
| **V** headless | `claude -p`가 `Skill` 도구를 돌린다. `--setting-sources project`, `--strict-mcp-config`, `--allowedTools`, `--output-format stream-json`으로 모든 도구 호출의 깨끗한 기록을 얻었다(이 조사의 도구). |
| **U** 시험하지 않음 | `/loop` fire에서 호출한 skill, 규칙 따르는 역할의 compaction 품질, headless 실행에서 실제 세션으로 보내기(ATC-274와 같음). |

`rules-drift`와 `manual check`와의 관계: `rules-drift`는 `--files`(저장소 기준 경로)를 받으므로 skill 파일도 넣으면 볼 수 있지만, hook 명령이 그 파일을 적은 세션에서만 그렇다. `atcctl manual check`는 이미 OCC 절차 파일을 해시하므로 역할의 skill도 `manualFiles`에 같은 식으로 더할 수 있다. **U**: Claude Code 자체의 skill 변경 반영(S)이 개인·프로젝트 skill에는 이를 중복으로 만드는가.

## 4. 옵션

### 4.1 평가

신뢰도 = 세션이 맞는 때 맞는 절차를 여는가. 등급은 `deploy/landing-tier.mjs`를 따른다: 저장소 루트 `.claude/`의 skill은 `user`, 관제 폴더 `.claude/`는 `flagged`, `rulebook/` 같은 새 최상위 폴더는 **`auto`**(그 규칙에 없다, 스크립트로 확인)이며, 에이전트 지침에는 틀리므로 그 자체가 먼저 할 `user` 변경이다.

| # | 옵션 | 신뢰도 | 토큰 | 바뀌는 것 | 등급 | 노력 | Shadow? | 판정 |
|---|---|---|---|---|---|---|---|---|
| 1 | **현상 유지**: 규칙은 `CLAUDE.md`, skill은 loop와 작업에만 | 작은 파일에서는 좋음(scratch 15/16). 파일이 커지고 비정상 규칙이 15 KB 중 한 문단이면 떨어짐(ATC-274: 긴 컨텍스트 위쪽 규칙은 덜 따름) | 모든 규칙을 늘 지불(7~17 k) | 없음 | — | — | — | **memory item 전용으로만 유지** |
| 2 | **설명으로 고르는 QRH skill** | skill 8개면 15/16. **88개면 맞는 skill 2/16, 순서대로 4/16** — 설명이 빠져서(4.2). atc가 도는 계정은 plugin 목록이 클 수 있어(ATC-274는 목록·plugin 컨텍스트를 약 20 k 토큰으로 봄) 둘째 경우가 그럴듯하다. 실제 관제 세션에서 재지는 않았다 | 목록의 이름+설명, 본문은 열 때만 | 새 skill | `flagged`/`user` | M | 가능 | **단독 기제로는 기각** |
| 3 | **ECAM식 연결**: 서버가 보내는 글에 체크리스트 이름을 넣음 | **16/16과 16/16**, skill 88개에서도 | 메시지당 짧은 한 줄, 본문은 열 때만 | 서버의 코드 → 체크리스트 표, 서버가 만드는 글에 한 줄 | `flagged`(보내는 글을 만드는 서버 코드) | M | 가능: 먼저 "QRH-x를 부를 것"만 기록 | **먼저 만든다** |
| 4 | **정상 체크리스트를 skill로**(`atc-task` 4~8의 push 전·PR 전·도착 보고) | 설명으로 고르면 2와 같고, briefing이나 앞 단계가 이름을 대면 3과 같다 | `atc-task`는 4.7 k를 한꺼번에 불러옴, 쪼개면 단계마다 | `atc-task`를 쪼갬 | `user`(루트 `.claude/`) | M | 일부 | **2차**, 비정상 묶음으로 형식이 통하는지 본 뒤 |
| 5 | **Memory item**은 `CLAUDE.md`에, 나머지는 밖으로 | 선: (a) 어기면 되돌리기 어렵거나 (b) 일어난 사건 없이 매 턴 적용되는 규칙만 memory item. 트리거를 댈 수 있는 것은 skill. hook이 이미 막는 규칙은 산문에서 뺀다 | 늘 불러오는 파일이 작아짐 | `CLAUDE.md` 수정 | `user`(루트), `flagged`(폴더) | S | 가능 | **나누는 규칙으로 채택** |
| 6 | **MEL skill**: 능력이 없을 때 세션이 할 일 | 참고 목록에 하나도 없어 해당 없음. 이름을 붙이려면 서버 신호("`gh` 없음", "Codex 한도")가 필요 | 절차마다 | 새 설계와 신호 | `flagged`/`user` | M–L | 가능 | **나중, 설계 먼저**(능력 목록과 수리 기한 필요) |
| 7 | **LAUNCH가 불러오는 규정집 plugin**(`--plugin-dir`) 대 저장소별 복사 | 2·3과 같다(기제가 같다). 핵심은 *배포* | 해당 없음 | `session-control.ts`가 `--plugin-dir`을 더함, `rulebook/` 폴더 | `flagged`(SIDE_EFFECT 파일)에 landing-tier 규칙은 `user` | M | 가능(시험 AIRCRAFT 하나) | **배포용으로 채택**(5.3) |
| 8 | **체크리스트 ID = 지식 ID**: `docs/knowledge.md` KID와 SAFETY REPORT `rule`에 연결 | 해당 없음(이름 붙이기) | 0 | ID 규칙, `rule`이 ID를 받음 | 문서 `auto`, 서버 검사 `flagged` | S | 가능 | **채택**: ID가 보고와 수정을 정확하게 만든다 |
| 9 | **코드로 막을 수 있는 것은 hook·guard만** | 가장 높음: 확률적이지 않음 | 0 | 이미 있음 | `user` | — | — | **유지하고 넓힌다.** 코드가 검사할 수 있는 규칙은 코드로, skill은 코드가 못 검사하는 것에 |
| 10 | **분리 컨텍스트 skill**(`context: fork`)로 무겁고 자족적인 절차 | 이 조사에서는 해당 없음 | 부모는 한 줄만 | 절차마다 | `flagged` | M | 가능 | **INSPECTION 같은 무거운 절차에만**(ATC-274 옵션 6과 같음) |

기각과 이유: **옵션 2 단독**(확률적이고 이 계정에서는 무너지는 것으로 측정됨), **안전 규칙을 설명에만 두기**(참고 저장소는 어디도 그러지 않고 하드 한계는 hook에 둔다), **에이전트가 자기 절차를 다시 쓰기**(noodle `reflect`) — 개정은 PR과 `user` 등급을 거쳐야 하므로.

### 4.2 scratch 실험: 세션이 맞는 절차를 여는가

**설정.** scratch 폴더, atc 상황에 맞춘 가짜 절차 여덟 개(`QRH-01`~`QRH-08`: undelivered FLIGHT PLAN, READBACK 없음, ARRIVED 미기록, GO AROUND, 승인 대기 멈춤, 통신 두절, 사용 한도, 서버 중단). 절차마다 가짜 `./atcx <단어>` 명령 3~4단계이고, 단어는 짐작할 수 없어서 순서대로 맞으면 절차를 읽었다는 증거다. 상황 글 여덟 개는 설명과 다른 말로 썼고 이웃한 쌍(undelivered 대 통신 두절)을 포함한다. 판정: stream-json 기록의 `Bash` 호출에 필요한 단어가 순서대로 나타남. "맞는 skill"은 절차 이름의 `Skill` 호출. Haiku 4.5, `claude -p`, `--setting-sources project`, 상황마다 2회, 조건당 16회.

| 조건 | 세션이 가진 것 | 순서대로 | 맞는 skill을 엶 | skill 호출 없음 | 다른·모르는 절차의 단계가 섞인 실행 | 실행당 읽은 평균 토큰 | 비용 |
|---|---|---|---|---|---|---|---|
| **A** | 절차 8개 전부 `CLAUDE.md`(≈ 1.3 k 토큰) | 15/16 | — | — | 1 | 106 k | 0.37 USD |
| **B** | skill 8개, 설명으로 고름 | 15/16 | 15/16 | 0 | 1 | 149 k | 0.46 USD |
| **C** | B에 경보 글 끝 "Checklist: QRH-xx (이름). Open that skill" | **16/16** | 16/16 | 0 | 0 | 144 k | 0.42 USD |
| **D** | B에 닮은 미끼 skill 80개(프로젝트 skill 88개) | **4/16** | **2/16** | 11 | 12 | 159 k | 0.51 USD |
| **E** | D에 경보 글이 체크리스트를 부름(C처럼) | **16/16** | 16/16 | 0 | 0 | 143 k | 0.45 USD |

"읽은 평균 토큰"은 한 실행의 모든 요청에서 입력과 cache-read 토큰을 더한 것이라 `Skill` 호출의 추가 요청이 들어간다. 요청 하나의 크기가 아니다. 비용은 실행의 `total_cost_usd`다.

빗나간 경우: A와 B에서 같은 상황이 한 번씩 틀렸다. undelivered FLIGHT PLAN("no such session")을 이웃인 통신 두절로 본 것이다(A는 통신 두절과 GO AROUND의 단계를 섞었고, B는 통신 두절 skill을 열었다). D에서는 세션이 **`Skill`을 아예 부르지 않은** 경우가 대부분(16개 중 11개)이었고 없는 명령(`--help`, `declare-emergency`, `approve`)을 지어냈다. 절차 없이 자신 있게 행동하는, 가장 위험한 실패다. 같은 폴더의 확인으로 원인이 보였다: 프로젝트 skill 88개가 모두 이름만 보였다.

**읽기.**

1. 작고 깨끗한 묶음에서는 설명 고르기와 파일 안 규칙이 모두 작은 모델에서 통한다(15/16). 비율로 읽지 않는다. 표본이 16회이고, 절차는 가짜이며 짧고, 한 턴은 쉽다.
2. D가 B보다 실제에 가까울 수 있다. 이 세션의 목록도 길고(plugin skill 다수가 이름만 보임), ATC-274는 목록·plugin 컨텍스트를 약 20 k 토큰으로 보고, 문서는 예산을 넘으면 설명이 빠진다고 한다. 실제 관제 세션이 예산을 넘는지는 재지 않았다. 넘으면 설명만으로 고르기는 조용히 실패한다.
3. 글에 체크리스트 이름을 넣으면(C, E) **D 상황에서도** 실패가 없어졌다. 이름은 목록에 남고 `Skill` 도구는 이름을 받기 때문이다. 옵션 3의 근거다. 모델이 짐작할 필요가 없다.
4. 조건 A에는 표가 가리는 비용이 있다: 늘 불러오는 큰 파일이면 절차를 모든 요청에서 지불하고, skill이면 열 때 한 번 지불한다.

**재지 않은 것**: Sonnet 5.5(관제 세션)나 Opus, 경보와 사용 사이의 긴 대화, `/loop` 안에서 연 skill, compaction, 판단 단계가 있는 실제 절차. 실제 모델과 실제 절차로 shadow 기간에 다시 잰다(5.4).

## 5. 권고

### 5.1 구조

항공처럼 **세 층**에, 선 긋는 규칙을 둔다:

| 층 | 담는 것 | 형태 | 불러오는 때 |
|---|---|---|---|
| **한계** | 절대 일어나면 안 되고 코드로 검사할 수 있는 것 | guard와 hook(`*guard*.mjs`, `hooks/`) | harness가 돌림, 읽지 않음 |
| **Memory item** | 많아야 약 10개의 한 줄 규칙: 어기면 되돌리기 어렵거나 매 턴 적용됨(패턴으로 kill 금지, fail-closed guard, READBACK 형식과 세션 이름으로 답장, 언어 규칙, 다른 팀에 메시지 금지, `main`에 push 금지) | 루트와 폴더 `CLAUDE.md` 맨 위의 짧은 블록 | 항상 |
| **절차** | 트리거 조건이 있는 모든 것 | skill: `sop-*`(비행마다), `cl-*`(정상 체크리스트), `qrh-*`(비정상·비상), `mel-*`(능력 없음) | 목록의 이름은 항상, 본문은 열 때 |

배경(FCOM)은 `docs/`에 두고 불러오지 않는다.

**skill 형식**(QRH 항목). 한 화면에 읽을 만큼 짧게:

```
---
name: qrh-04-go-around
description: Use when TOWER sends a GO AROUND clearance for your PR.
---
# QRH-04 go-around   rev 2026-10-01.1   owner: TOWER manual
Condition: <한 문장>
Steps (one Bash call each, in order): 1. … 2. …
Stop and report if: <불일치 규칙, humanlayer의 "Expected / Found / Why"처럼>
End state: <끝났을 때 참인 것>
Report line: <고정 READBACK 또는 보고 글>
```

- **ID**: `<종류>-<번호>-<slug>`, 종류는 `sop`, `cl`, `qrh`, `mel`. 번호는 바뀌지 않고 다시 쓰지 않는다. 개정 문자열 `rev <날짜>.<n>`은 본문에 둔다. SAFETY REPORT `rule`이 싣는 것이 이 ID이고 `docs/knowledge.md`가 링크할 수 있는 것도 이 ID다.
- **언어.** skill 본문은 영어: 세션이 읽고 세션끼리 영어로 말하며(ATC-126) 영어가 한국어 파일보다 토큰이 적다(대략 바이트당 0.25 대 0.44, 여기서 재지 않은 어림). 체크리스트마다 SUPERVISOR용 요약은 한국어 안내에 둔다. 지금 관제 매뉴얼은 한국어 원본에 `*.en.md` 번역이므로 이것은 **SUPERVISOR 결정(D1)** 이다.

### 5.2 맞는 절차를 여는 방법

**옵션 3**(서버가 이름을 댐)에 **옵션 9**(코드로 검사할 수 있는 것은 hook과 guard)를 쓴다. 서버에는 이미 대부분의 상황에 안정적인 코드가 있다: `undelivered`, `overdue`, `arrivalMissing`, FOLLOWING 이슈 코드(`no-pr`, `pr-not-cleared`, `unable`, `undelivered`), health `RESUME`·`STALLED`, CLEARANCE `GO AROUND`. 순수 표 `qrhOf(code)`가 코드를 체크리스트 이름에 대응시키고, 서버가 이미 만드는 글(brief 필드, send guard가 바꿔 넣는 CLEARANCE·FLIGHT PLAN 문구, TOWER LOG 줄) 끝에 `Checklist: qrh-04-go-around` 한 줄이 붙는다. 모델이 고르지 않는다. 설명은 서버가 보지 못하는 상황의 fallback이다.

### 5.3 모든 AIRPORT의 AIRCRAFT에 닿게 하는 방법

LAUNCH는 atc 자신의 코드(`claude --bg …`, `server/session-control.ts`)다. 거기에 `--plugin-dir <atc>/rulebook`을 더하면 skill 한 폴더(plugin이라 이름은 `atc-rulebook:qrh-04-go-around`로 이름공간이 나뉨)가 어느 저장소에서 일하든 atc가 띄우는 모든 AIRCRAFT와 관제 세션에 닿는다. scratch에서 확인했다: 무관한 작업 폴더에서 `claude -p --plugin-dir <dir>`이 plugin의 skill을 목록에 올렸고 `Skill` 호출이 경보 글의 평범한 이름을 이름공간이 붙은 `atc-rulebook:qrh-04-go-around`로 풀었다. 문서는 로컬 디렉터리에서 불러온 plugin을 세션 시작마다 그 자리에서 읽는다고 한다(로컬 디렉터리 marketplace에 대해 문서화됨, `--plugin-dir` 자체는 **U**). 그렇다면 이 호스트에서는 관리할 캐시도 자동 업데이트도 없다: 개정은 착륙한 commit이고 다음 LAUNCH가 본다. CREW BRIEFING에는 규정집을 부르는 한 줄을 넣고, plugin 없이 뜬 AIRCRAFT(손으로 연 세션)를 위해 memory item은 inline으로 둔다. 돌고 있는 세션은 다시 시작하거나 `/reload-plugins`를 하기 전까지 옛 글을 쓴다. 본문의 개정 문자열이 이를 보이게 한다.

- **개정과 ack.** `atcctl manual check`와 `rules-drift` hook 목록을 규정집 파일까지 넓혀, 바뀐 skill도 바뀐 매뉴얼과 같은 `CHANGED … ack` 알림을 내게 한다(관제 매뉴얼은 OCC 절차 파일에 이미 그렇다). **U**: AIRCRAFT에는 Claude Code 자체의 skill 변경 반영(3장)으로 충분한가. shadow에서 시험한다.
- **착륙 등급.** `deploy/landing-tier.mjs`의 `USER` 목록에 `rulebook/`을 먼저 더한다. 지금은 `auto`로 착륙하는데 에이전트 지침에는 틀리다. 그 뒤 규정집 PR은 guard처럼 `user`다.
- **다른 호스트나 원격 AIRPORT**(일반적으로): plugin 디렉터리는 기계 사이에 공유되지 않는다. 거기서는 `version`을 고정한 marketplace나 같은 LAUNCH 코드가 관리하는 사본이다. 여기서는 설계하지 않았다.

### 5.4 무엇을 먼저 만드나

1. **먼저 shadow(flagged, 동작 변화 없음):** `qrhOf(code)`와 서버가 체크리스트를 불렀을 FLIGHT RECORDER 줄 `qrh.named`, 대화 기록의 Skill 호출 읽기(이름과 시각만). 분모를 얻는다.
2. **시험 skill 넷**: 절차가 없고 비용이 실제였던 곳. `qrh-lost-comms`(AIRCRAFT, ATC-258 F4), `qrh-stalled`, `qrh-undelivered`(OCC), `qrh-arrival-missing`. `qrh-go-around`는 `CLAUDE.md`에서 그대로 꺼내 옮기는 것으로 옮기기의 첫 시험을 한다.
3. **memory item 블록**을 루트 `CLAUDE.md` 맨 위(≤ 10줄)에, GO AROUND를 꺼내는 같은 변경에서.
4. **plugin 배달과 `--plugin-dir`** 은 landing-tier 규칙 뒤에.
5. 그다음 `atc-task`에서 정상 체크리스트 분리, MEL 설계, SAFETY REPORT `rule` = ID 변경.

### 5.5 앞선 조사들과의 관계

- **ATC-274 권고 2**는 규칙을 `/tick`에서 `CLAUDE.md`로 옮긴다(`/tick` 본문은 포인터가 됨. 매 tick 다시 보내지만 `CLAUDE.md`는 한 번 불러오므로). **이 조사는 `/tick` 본문에 동의하고, 옮긴 규칙이 어디로 가는지를 다듬는다**: tick마다 적용되는 SOP 규칙은 `CLAUDE.md`로(매 턴 적용되므로 5.1에 따라 memory item), *조건* 규칙은 `CLAUDE.md`가 아니라 skill로 보내 늘 불러오는 파일이 다시 커지지 않게 한다. 두 권고가 같은 파일을 건드리므로 ATC-274 작업 지시서 2(포인터)를 먼저 하고 조건을 skill로 옮긴다.
- **ATC-258 F4**(AIRCRAFT의 통신 두절 규칙)는 `qrh-lost-comms`가 되어 더 길어진 CREW BRIEFING이 아니라 plugin으로 닿는다. F2의 phase ladder가 `qrh-*` skill에 이름을 붙일 코드를 주고, F12(사건이 스스로 보고됨)는 체크리스트 ID로 보고한다.
- **SAFETY REPORT** `rule`은 체크리스트 ID와 개정이 되어, 보고 묶음이 절차 하나를 가리킨다. 일회성과 구별하기 어려워 S0에서 뺀 `no-rule`은, 절차 목록이 생기면 쓰기 쉬워진다: "이 조건에는 체크리스트가 없다".

### 5.6 잘 됐는지 아는 방법

| 측정 | 방법 | 판단 기준 |
|---|---|---|
| **이름 붙임→열림 비율**: `qrh.named` 줄 중 같은 턴 안에 그 이름의 `Skill` 호출이 뒤따른 비율 | FLIGHT RECORDER 줄을 대화 기록의 `Skill` 호출(이름과 시각만)과 맞춤 | 표를 넓히기 전 shadow에서 ≥ 95 %, 90 % 아래면 멈추고 살핀다 |
| **다른 절차·절차 없음 비율** | 이름 붙은 뒤 다른 절차의 단계, 이름 붙은 상황에서 `Skill` 호출 없는 행동 | 0으로 감소 |
| **조건에서 첫 맞는 단계까지의 시간**(undelivered, stalled, lost comms별) | 서버 기록(조건 코드 시각)과 첫 단계 기록 | ATC-258 I1의 33분 기다림보다 짧게 |
| **SUPERVISOR가 찾은 사건 대 세션이 찾은 사건** | ATC-258과 같은 손 집계 | 세션이 찾는 비율이 오름 |
| **SAFETY REPORT** | 체크리스트 ID별 `ambiguous-rule`·`repeat-ask` 수 | 개정 뒤 감소, 보고마다 ID를 가리킴 |
| **늘 불러오는 토큰** | 루트+폴더 파일 크기, 목록 크기(ATC-274 장부) | 절차가 밖으로 나갈수록 늘 불러오는 부분이 줄어듦 |
| **개정 ack 지연** | skill 변경 뒤 `manual check`·`rules-ack` 기록 | 살아 있는 세션이 모두 한 tick이나 한 LAUNCH 안에 ack |

## 6. 후속 작업 지시서(Linear에는 만들지 않음)

DUTY나 ENGINEERING이 만든다. 저장소 루트 `.claude/` 아래 새 skill은 `user` 등급이다.

| # | 제목 | 범위 | 예상 등급 |
|---|---|---|---|
| 1 | 규정집 착륙 등급: `USER` 목록에 `rulebook/` 추가 | `deploy/landing-tier.mjs`(+ 시험) | `user`(`deploy/`) |
| 2 | `qrhOf(code)`와 `qrh.named` shadow 기록 | 기존 코드 위의 `server/` 순수 표, FLIGHT RECORDER 줄. 글 변경은 아직 없음 | `flagged` |
| 3 | 이름 붙임→열림 비율을 읽는 Skill 호출 읽기 | 대화 기록에서 이름과 시각만, READABILITY 패턴의 하루 한 줄 | `auto` |
| 4 | 시험 QRH skill 넷과 형식(`qrh-lost-comms`, `qrh-stalled`, `qrh-undelivered`, `qrh-arrival-missing`) | 새 `rulebook/` plugin 폴더, 영어 본문, 각각 ATC-258의 사건에 링크 | WO 1 뒤 `user` |
| 5 | GO AROUND를 `qrh-go-around`로 옮기고 memory item 블록 추가 | 루트 `CLAUDE.md`와 `rulebook/`을 한 PR에, ATC-274 작업 지시서 2와 맞춤 | `user` |
| 6 | 서버가 만든 글에 체크리스트 이름 넣기 | brief 필드, send guard 대체 문구, TOWER LOG. shadow 비율이 유지된 뒤 | `flagged`(guard 문구 변경은 SUPERVISOR에게 먼저) |
| 7 | LAUNCH의 `--plugin-dir`과 CREW BRIEFING 한 줄 | `server/session-control.ts`, `server/fleet.ts` | `flagged` |
| 8 | 규정집의 개정과 ack | `atcctl manual check`, `rules-drift --files`, 돌고 있는 AIRCRAFT가 바뀐 skill을 보는지 시험 | `flagged`/`user`(hook) |
| 9 | `atc-task`에서 정상 체크리스트 분리 | `cl-*` skill, `atc-task`는 라우터로 남김 | `user` |
| 10 | SURVEY 또는 설계: MEL(능력 없음) skill | 능력 목록, 신호, 수리 기한 | `auto`(문서) |
| 11 | SAFETY REPORT `rule`이 체크리스트 ID를 받고 `no-rule` 종류 추가 | [safety-report.md](../safety-report.md) S0/S2 | `flagged` |
| 12 | 실제 모델·실제 절차로 호출 실험 반복, loop로 전달된 경보 포함 | scratch만, shadow 기간의 일부 | `auto`(문서) |

## 7. 이 조사가 말하지 않는 것

- skill이 파일 속 규칙보다 *더 정확하다*고 말하지 않는다. scratch에서 작은 파일 속 규칙 묶음도 skill만큼 했다(15/16). 논거는 크기, 목록 예산, atc의 파일을 읽지 않는 AIRCRAFT로의 배포, ID와 개정을 갖는 것이다.
- 비율을 보이지 않는다. 실험은 짧은 가짜 절차로 작은 모델에서 한 기제 확인이다.
- skill의 언어(D1), 옵션 5의 기준 너머 memory item의 선, 규정집이 plugin 하나인지 여럿인지를 정하지 않는다.
- 계정과 한도, 커진 skill 목록의 비용은 다루지 않는다. 목록은 ATC-274의 설명되지 않은 20 k 바닥의 일부이고 거기 작업 지시서(N2)가 잰다.

## 출처

- atc: [lost-comms-and-contingency.ko.md](lost-comms-and-contingency.ko.md)(ATC-258), [control-context.ko.md](control-context.ko.md)(ATC-274), [safety-report.md](../safety-report.md)(ATC-180), [knowledge.md](../knowledge.md)(ATC-104, ATC-105), [fleet.md](../fleet.md), [occ.md](../occ.md). `CLAUDE.md`와 관제 폴더의 `CLAUDE.md`, `.claude/skills/atc-task/SKILL.md`, `occ/.claude/skills/tick/`, `server/fleet.ts`(`crewBriefing`), `server/session-control.ts`, `hooks/rules-drift.mjs`, `controller/atcctl.mjs`(`manualFiles`), `deploy/landing-tier.mjs`.
- Claude Code 문서(2026-10-01): [skills](https://code.claude.com/docs/en/skills.md), [hooks](https://code.claude.com/docs/en/hooks.md), [plugin 로딩](https://code.claude.com/docs/en/plugins/loading.md), [plugins 참고](https://code.claude.com/docs/en/plugins-reference.md).
- 참고 skill(읽은 commit): [mattpocock/skills](https://github.com/mattpocock/skills) `d81f3a1`, [poteto/noodle](https://github.com/poteto/noodle) `82d2921`, [brainmaxxing](https://github.com/poteto/brainmaxxing) `ec4d8e4`, [verification-skill-example](https://github.com/poteto/verification-skill-example) `d5abe70`, [how](https://github.com/poteto/how) `b1ef429`, [humanlayer/humanlayer](https://github.com/humanlayer/humanlayer) `99abe67`, [skills](https://github.com/humanlayer/skills) `ca7c808`, [advanced-context-engineering-for-coding-agents](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents) `f2bc7ae`, [rpi-coordination-template](https://github.com/humanlayer/rpi-coordination-template) `90a4e7b`, [dexhorthy/slopfiles](https://github.com/dexhorthy/slopfiles) `f7a350a`, [emilkowalski/skills](https://github.com/emilkowalski/skills) `d16ebe6`.
- 항공(이름만 댐, 이 세션에서 가져오지 않음): ICAO Annex 6 Part I(운항교범 내용, MEL 규정), EASA ORO.MLR.100, 14 CFR 25.1581·91.213·121.133·121.315, 제작사의 QRH·FCOM·FCTM·ECAM/EICAS 문서, Degani·Wiener NASA CR-177549(1990)와 Human Factors 35(1993), NASA ASRS. [ATC-258](lost-comms-and-contingency.ko.md)의 출처 목록도 본다.
