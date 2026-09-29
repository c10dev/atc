# OCC 설계 (초안)

[English](occ.md) · **한국어**

atc는 항공처럼 관제 세션을 둘로 나눈다.

- **OCC**(운항통제센터, 항공사 쪽)는 **무엇을, 누가, 언제 날릴지** 정한다. 스케줄(Linear 티켓)을 관리하고, FLIGHT를 팀에 DISPATCH하고, 착륙할 때까지 따라간다.
- **ATC**(항공교통관제)는 이미 떠 있는 것들의 **간격을 지킨다**. 지금은 TOWER, 나중에는 흐름 관리(3단계)다.

실제 항공에서 운항관리사(flight dispatcher)는 ATC가 아니라 항공사 OCC에 속한다. 그래서 DISPATCH(2단계)를 OCC로 옮기고, 지금 "President" 세션이 손으로 하는 일을 OCC가 넘겨받는다.

> 상태:
>
> - **S0 구현**(2026-09-26): `atc/occ/` 세션(DISPATCH를 합침), 읽기 전용 `gh`, 읽기 전용 MCP guard, 매뉴얼 다시 읽기, planner의 TAIL ASSIGNMENT(`tail:TEAM_X`, [fleet.ko.md](fleet.ko.md) 참고).
> - **S1 구현**: `CLASSIFY`, `PRIORITIZE`, `NEW`, `CLOSE`, `TAIL`의 SCHEDULE 초안을 그림자 운용한다(`server/schedule.ts`, `atcctl schedule brief|draft`, SCHEDULE 탭, OCC 규칙).
> - `NEW`는 CHARTER DESK다. CHARTER REQUEST로 AD HOC FLIGHT 초안을 만든다. 본문 섹션을 점검하고, 스냅숏(최근 45일 안에 바뀐 이슈)에서 제목이 비슷한 중복을 찾는다.
> - `CLOSE`(5.5, 2026-09-27 구현)는 PR이 머지된 FLIGHT를 닫자는 초안이다. release하지 않고, 이슈는 SUPERVISOR가 Linear에서 닫는다.
> - 열린 초안은 종류를 합쳐 최대 5건이다. 판정 없이 3일이 지나면 만료된다.
> - ATC의 CLEARED TO LAND 점검(9장)은 구현됐다. LANDING SEQUENCE는 이제 열린 GitHub PR에서 나온다.
> - `TAIL`(아래 "TAIL as built", 2026-09-28 ATC-68 구현)은 DISPATCH 밖에서 정한 배정을 `tail:TEAM_X` 라벨 초안으로 남긴다.
> - 나머지 작업(`LINK`, `SPLIT`, `COMMENT`)과 S3는 설계만 있다(아직 만들지 않음).
> - S2(승인 운용: linear-guard, `schedule release`, APPLIED 감지)는 `mode` 뒤에 구현돼 있고 기본은 꺼짐. "S2 켜는 법" 참고.
> - 결정 사항은 맨 아래 "결정"에 있다.

## 1. 지금 사실

2026-09-26, S0 전의 스냅숏이다. 그 뒤에 바뀐 것은 위 상태 줄에 있다.

| 항목 | 현재(2026-09-26) |
|---|---|
| 그룹 책임자 | `vocado_nextjs`의 "President" 세션. TEAM_A … TEAM_F 위에 있다. 일을 맡기고, 팀 보고를 GitHub·Linear·DB로 확인하고, PR을 리뷰하고 Codex 지적을 판단하고, Linear를 정리하고, 규칙 파일(`CLAUDE.md`, PR 템플릿)을 관리하고, 머지·닫기·범위 결정은 사용자에게 넘긴다. 제품 코드는 쓰지 않고 머지할 수 없다 |
| DISPATCH | 별도 세션(`atc/dispatch/`)에서 그림자 운용(2a) 중. 제안을 검토하고 메모·CAUTION·HOLD를 단다. Linear에 쓰지 않는다. S0에서 OCC에 합쳐졌고, 폴더는 이제 `occ/`다 |
| TOWER | 1단계 관제: LOSS OF SEPARATION, HANDOFF, LANDING SEQUENCE |
| Linear에 쓰는 사람 | 팀 리더만(vocado `CLAUDE.md`: "Linear에는 리더만 쓴다"). 실제로는 President도 이슈를 만들고, 우선순위를 바꾸고, 닫는다 |
| 상태 변경 | GitHub 연동이 이슈를 In Progress / In Review로 옮긴다. 머지로 Done이 되는 것은 PR 본문에 `Fixes VOC-n`이 있을 때뿐이다. 다른 머지 뒤에는 이슈가 열린 채 남는다. `CLOSE`(5.5)와 `merged-not-done`(8.1)이 이 경우를 다룬다 |

2026-09-26 하루에 생긴 문제:

| 사건 | 드러난 것 |
|---|---|
| VOC-196: President는 TEAM_E에 맡겼는데, DISPATCH는 TEAM_D에, 그다음 TEAM_B에 제안했다 | 서로를 못 보는 DISPATCH가 둘 |
| VOC-56: 몇 주 전에 끝났는데 아직 열려 있고, 두 번 제안됐다 | 완료 기준을 이미 채운 이슈를 닫는 사람이 없다 |
| VOC-195: VOC-193 중에 발견한 race를 손으로 떼어 냈다 | 후속 티켓은 누군가 기억해서 써야만 생긴다 |
| VOC-177, VOC-179, VOC-195: 우선순위 없는 Todo | 분류(triage)가 누구의 일도 아니다 |
| 규칙이 바뀐 뒤에도 DISPATCH가 옛 `CLAUDE.md`를 들고 있었다 | 오래 도는 관제 세션은 매뉴얼을 다시 읽을 방법이 필요하다 |

## 2. 원칙

1. **세션 둘, 질문 둘.** OCC는 무엇을 날릴지 정하고, ATC는 간격을 지킨다. 일을 계획하고 배정한 쪽은 그 일이 만든 충돌을 심판하지 않는다.
2. **결정은 SUPERVISOR(사용자).** OCC는 초안을 쓰고, ATC는 보고하고, SUPERVISOR가 승인한다. 자동화는 DISPATCH처럼 한 단계씩 늘린다(그림자 → 승인 → 위험 낮은 것만 자동).
3. **Linear 필드마다 주인은 하나.** OCC는 계획 필드, CAPTAIN은 실행 필드를 가진다(4장). 두 쪽이 같은 필드를 두고 다투지 않는다.
4. **Linear 쓰기는 모두 추적된다.** 쓰기마다 SCHEDULE id(`[OCC S-0001]`)가 붙고, guard가 승인된 작업과 맞는지 확인하고, FLIGHT RECORDER에 남는다.
5. **코드도 머지도 안 한다.** OCC는 코드도 규칙 파일도 바꾸지 않는다. 규칙을 바꾸려면 티켓을 만들고 TEAM이 PR로 구현한다. 머지는 SUPERVISOR만 한다.
6. **사람이 직접 한 배정이 여전히 우선**이다. DISPATCH와 같다.

## 3. 역할과 권한

| 역할 | 누구 | 하는 일 | 쓸 수 있는 것 |
|---|---|---|---|
| SUPERVISOR | 사용자 | SCHEDULE 작업과 DISPATCH 제안 승인, 머지, 최종 권한 | 전부 |
| OCC | Claude 세션 하나(`atc/occ/`). DISPATCH와 President를 대신한다 | SCHEDULE(티켓 만들기·분류·닫기), DISPATCH(제안, FLIGHT PLAN, READBACK), 운항 추적(팀 보고 확인) | atc CLI, SendMessage(send-guard), Linear 쓰기(linear-guard), 읽기 전용 `gh` |
| ATC (TOWER) | 1단계 관제 | LOS, HANDOFF, LANDING SEQUENCE, CLEARED TO LAND 점검. 3단계에서 흐름 관리 | atc CLI, SendMessage |
| CAPTAIN | 각 TEAM 리더 | READBACK 또는 사유, Linear 실행 필드, 작업 자체 | 자기 저장소, Linear 실행 필드 |
| President | 지금의 그룹 책임자 | OCC가 그 일을 다 맡으면 물러난다(8장) | — |
| Symphony | 다른 운항사 | `symphony-pilot` FLIGHT | OCC는 건드리지 않음 |

## 4. Linear 필드 주인

| OCC (계획) | CAPTAIN (실행) |
|---|---|
| 이슈 만들기(제목, 템플릿에 따른 본문, 프로젝트) | 작업을 시작하면 In Progress로 옮기기 |
| 우선순위 | PR 설명(`Fixes VOC-n`). GitHub 연동이 이걸로 상태를 옮긴다 |
| `tail:TEAM_X` 라벨(TAIL ASSIGNMENT: 어느 팀이 날아야 하나)과 분류 라벨 `type:`, `wake:`, `rating:`([fleet.ko.md](fleet.ko.md)) | 시작·PR·막힘·완료 때 짧은 댓글 |
| 상위 / 하위 연결, `blocks` / `blocked by` 관계 | |
| 닫기 제안: 근거(머지된 PR)를 담은 `CLOSE` 초안. Linear에서 Done으로 옮기는 것은 **SUPERVISOR**다. vocado의 OCC 예외 규칙상 OCC는 상태나 담당자를 바꾸지 않기 때문이다(5.5). 중복 표시 | |

어느 쪽도 Linear API로 PR 링크를 붙이지 않는다(vocado 규칙: 첨부는 rate limit에 걸린다).

## 5. SCHEDULE 작업

OCC는 Linear에 마음대로 쓰지 않는다. **SCHEDULE 작업**(operation)을 초안으로 쓴다. 작업 하나는 변경 하나이고, id(`S-0001`), 이유, 그리고 실제로 쓸 payload를 그대로 가진다.

| 작업 | 뜻 | 예 (2026-09-26) |
|---|---|---|
| `NEW` | 티켓 만들기 | VOC-193에서 batch-processor race를 떼어 냄(VOC-195가 됨) |
| `CLOSE` | ✅ 구현(5.5): FLIGHT의 PR이 머지됐는데(LOGBOOK ARRIVED) 이슈가 아직 열려 있음. 승인된 초안은 SUPERVISOR가 Linear에서 닫는다. release하지 않는다 | VOC-56: `protect main` ruleset이 이미 완료 기준을 모두 채움 |
| `PRIORITIZE` | 우선순위를 정하거나 바꿈 | VOC-177, VOC-179, VOC-195에 우선순위가 없음 |
| `TAIL` | ✅ 구현("TAIL as built", ATC-68): `tail:TEAM_X`를 더하거나 바꿈(TAIL ASSIGNMENT) | VOC-196 → `tail:TEAM_E`(President가 정한 대로) |
| `CLASSIFY` | FLIGHT TYPE, WAKE CATEGORY, 필요한 TYPE RATING을 정함([fleet.ko.md](fleet.ko.md) 4장) | VOC-195 → `type:MAINT`, `wake:M`, `rating:SEC` |
| `LINK` | 상위, `blocks`, `related` 관계 더하기 | VOC-196은 VOC-52에 막혀 있음(본문에만 적힘) |
| `SPLIT` | 발견한 것을 하위나 related 티켓으로 | PR #400 리뷰의 P3 항목 |
| `COMMENT` | 계획 댓글 남기기(실행 댓글이 아님) | "VOC-52가 끝날 때까지 미룸" |
| `TARGET`, `ROUTE` | ✅ S1 만듦(ATC-25): Linear가 아니라 AIRCRAFT의 FLEET TARGETS·ROUTE 변경. 두 모드 모두 그림자 판정만, 게이트와 따로 센다([fleet.ko.md](fleet.ko.md) 7.4) | TEAM_C에서 `Home & Discovery` 빼기(completed) |

구현: `NEW`(CHARTER DESK, 5.1), `CLOSE`(5.5), `PRIORITIZE`, `CLASSIFY`, `TAIL`("TAIL as built"), 그림자 운용의 `TARGET`·`ROUTE`([fleet.ko.md](fleet.ko.md) 7.4). 아직 만들지 않음: `LINK`, `SPLIT`, `COMMENT`.

### 5.1 작업은 어디서 오나

- **SUPERVISOR의 지시(CHARTER DESK)**: OCC 세션에서 바로 하는 CHARTER REQUEST("X 티켓 만들어 줘")는 `NEW` 초안, 곧 AD HOC FLIGHT(정규 스케줄 밖에서 더한 FLIGHT)가 된다.
  - 승인되고 Linear Todo에 오르면(S2) 다른 FLIGHT처럼 FILED된다.
  - 팀에 바로 맡긴 작은 티켓 없는 일은 AD HOC이고, SCHEDULE 작업이 되지 않는다.
  - OCC는 스스로 `NEW`를 쓰지 않는다. 예외는 하나, 덮는 이슈가 없는 WAYPOINT 완료 기준이다(5.6). SUPERVISOR가 이미 적어 둔 기준을 옮기는 것이다.
  - 중복 검색(5.3)은 atc의 스냅숏을 본다. 스냅숏에는 최근 45일 안에 바뀐 이슈가 있다.
  - SUPERVISOR가 말한 배정("VOC-196은 TEAM_E가 맡는다")은 `TAIL` 초안이 된다(아래 "TAIL as built").
- **팀의 발견**: CAPTAIN이 "범위 밖에서 Y를 찾았다"고 보고 → `SPLIT`.
- **PR 리뷰**: 리뷰의 후속 항목 → `SPLIT`.
- **atc 신호**: 끝났는데 열려 있음(`CLOSE`), 우선순위 없음(`PRIORITIZE`), `tail:` 없이 팀이 몰고 있음(`TAIL`, 아래 "TAIL as built"), 본문에만 적힌 선행 작업(`LINK`), 방치된 ENROUTE(DISPATCH의 `RELEASE` 경우).
- **4단계 네트워크 계획**: 목표를 티켓으로 나눈 것. 초안으로만.
- **WAYPOINT gap**(5.6): 지금 구간이나 다음 WAYPOINT의 완료 기준 가운데 덮는 이슈가 없는 것 → 마일스톤을 단 `NEW`.

### 5.2 티켓 본문

`NEW`와 `SPLIT`은 DIRECT 형식을 쓴다([dispatch.ko.md](dispatch.ko.md) "DIRECT briefs", 2026-09-28부터). 목표와 완료 기준이 필수이고, 제약은 이 작업만의 것만 적는다. DB·마이그레이션·보안·권리 작업은 짧은 Hard constraints 줄이 더 있다. 늘 지키는 규칙은 vocado `CLAUDE.md`·`AGENTS.md`에 둔다. 이런 티켓에는 늘 CAUTION이 붙고, CAUTION 작업은 절대 자동이 아니다(7장).

### 5.3 중복과 한도

- `NEW`나 `SPLIT` 전에 OCC는 열린 이슈와 최근 닫힌 이슈를 찾아보고, 찾은 결과를 작업에 남긴다("중복 없음: X, Y 검색").
- 열린 초안은 종류를 합쳐 최대 5건이다(`server/schedule.ts`의 `SCHEDULE_OPEN_LIMIT`). 넘으면 atc가 새 초안을 거부하고(409), OCC는 초안을 멈추고 보고한다. 적용된 `NEW` / `SPLIT`의 하루 한도(하루 10건, 설정 파일)는 아직 만들지 않았다.
- `CLOSE`에는 OCC가 직접 확인한 근거가 필요하다: 머지된 PR, 설정 읽기, 댓글. "끝난 것 같다"로는 안 된다.

### 5.4 CLASSIFY 정확도

첫 SCHEDULE 판정 7건(2026-09-26)에서 SUPERVISOR가 거절한 초안 3건은 모두 CLASSIFY를 잘못 읽은 것이었다.
- **S-0001 (VOC-195), S-0004 (VOC-196):** [fleet.ko.md](fleet.ko.md) 4.1은 `MAINT`인데 FLIGHT TYPE을 `BUILD`로 했다. 하나는 lock race 수정, 하나는 CI·정적 게이트였고, 둘 다 제품 동작을 바꾸지 않는다.
- **S-0006 (VOC-181):** 4.2는 `L`인데 WAKE를 `M`으로 했다. 파일 하나에 규칙 둘, 새 테스트 없음.

4.1을 인용한 CROSSCHECK는 이것들을 맞혔다. 이제 OCC도 같은 방식으로 한다(`occ/.claude/skills/tick/schedule.md` "CLASSIFY 전에").

- **기준을 읽는다:** 한 바퀴에서 CLASSIFY를 하기 전에 OCC는 `docs/fleet.md` 4.1–4.3을 읽는다. `occ/.claude/settings.json`이 `permissions.additionalDirectories: ["../docs"]`를 더해서, 비대화형 세션도 Read할 수 있다. 이게 없으면 읽기가 거부됐다.
- **FLIGHT TYPE은 정해진 순서로:** CHECK(결과물이 판정) → SURVEY(조사나 계획, 코드 없음) → TEST(버릴 spike) → FERRY(기계적 이동) → MAINT(제품 동작 그대로: 리팩터, 인프라, CI, 정적 게이트, 테스트, 보이지 않는 race·lock 수정) → BUILD. BUILD는 사용자가 보는 기능·동작·화면이 바뀔 때만이다. 보안 면이나 테스트만으로는 BUILD가 되지 않는다.
- **WAKE는 실제 변경 크기로:** 허용 범위에 테스트 파일이 있다고 새 테스트가 있는 것은 아니다.
- **이유에 절 번호를** 축마다 적는다. 예: `4.1 MAINT: … · 4.2 M: … · 4.3 SEC: …`.
- **보정 예시:** `GET /api/schedule/brief`(와 `atcctl schedule brief`)에 `examples`가 있다. 최근 SUPERVISOR 결정 8건까지이고, 이유가 있는 것이 먼저다. CROSSCHECK와 같은 `examplesOf`로 만든다: `{id, kind, flight, proposed, draft, verdict, reason}`.
  - `proposed`는 OCC가 초안으로 낸 분류나 우선순위다. NEW 본문이나 비슷한 제목 목록은 빠진다.
  - OCC는 초안을 쓰기 전에 이것을 읽고, 거절 사유가 짚은 실수를 되풀이하지 않는다.

합성 데이터로 시험 서버에서 확인했다.
- **예시가 없을 때,** OCC `/tick`은 VOC-196 `MAINT · M · SEC`, VOC-195 `MAINT · M · SEC`, VOC-181 `BUILD · L · UI`로 초안을 냈다. 셋 다 SUPERVISOR 판정과 맞고, 이유마다 4.1–4.3을 인용했다.
- **합성 거절 2건을 예시로 줬을 때,** VOC-192는 `BUILD`로 냈다(레이아웃이 바뀐다). 예시 때문에 반대로 지나치게 고치지는 않았다.

### 5.5 CLOSE (2026-09-27 구현)

Linear 정리는 원래 President의 일이었다. 이제 OCC가 초안을 쓰고, SCHEDULE에 초안이 다시 꾸준히 들어온다. 규칙:

- **후보**(`schedule brief` → `candidates.close`, 자세한 것은 `close`): PR이 LOGBOOK에 ARRIVED로 있고 되돌리지 않았는데([fleet.ko.md](fleet.ko.md) 7.1), Linear 이슈는 Done도 Canceled도 아닌 FLIGHT. 머지가 오래된 것부터. 열린 CLOSE 초안이 있는 것은 뺀다.
  - FLIGHT에 PR이 여럿이면 본문에 `Fixes VOC-n`이 있는 PR을 쓰고, 없으면 가장 최근 것을 쓴다.
  - vocado 규칙상 이슈를 끝내는 것은 `Fixes`뿐이다. 본문에 `Part of VOC-n`이 있는 PR은 후보에서 뺀다.
  - PR 본문의 연결(`fixes`, `part-of`, `none`)은 새 LOGBOOK 줄에 저장된다(`link`). 예전 줄은 atc가 읽기 전용 `gh pr view --json body`로 본문을 한 번 읽고 캐시한다. 그 후보는 다음 브리핑에 나온다.
- **초안**(`atcctl schedule draft CLOSE <FLIGHT> -- <reason>`): atc가 LOGBOOK에서 payload를 채운다: `{pr: {repo, number, url}, mergedAt, fixes?, partOf?}`.
  - CLASSIFY·PRIORITIZE와 달리 FLIGHT가 열린 상태 어디에 있어도 된다(In Progress와 In Review가 흔하다).
  - 이슈가 이미 닫혔거나, FLIGHT에 ARRIVED 줄이 없거나, PR이 되돌려졌으면 초안을 거부한다.
  - `Part of` PR도 초안은 낼 수 있다(OCC가 나머지가 끝났음을 알 수도 있다). 다만 "Part of — 일부만"으로 보이고, CROSSCHECK에는 disagree하라고 알려 준다.
  - 이유에는 PR, 머지 시각, 본문에 `Fixes`가 있는지를 적는다. 열린 초안 한도(5)는 다른 종류와 똑같이 적용된다.
- **초안이 닫히는 경우**(`syncLines`):
  - Linear 이슈가 Done이나 Canceled가 됨 → SUPERSEDED. release됐던 것이면 APPLIED.
  - PR이 되돌려짐 → SUPERSEDED.
  - 결정 없이 3일 → EXPIRED. 승인된 CLOSE이면 사유는 "승인 뒤 3일 동안 Linear에서 닫히지 않음".
- **release하지 않는다.** CLOSE는 이슈 상태를 바꾸고, vocado의 OCC 예외 규칙상 OCC는 상태나 담당자를 바꾸지 않는다.
  - 그래서 `callsOf`가 거부하고, `schedule release`는 409 `CLOSE는 SUPERVISOR가 Linear에서 직접 — vocado 규칙상 OCC는 상태를 바꾸지 않음`으로 답한다. 따라서 linear-guard는 CLOSE 호출을 볼 일이 없다.
  - 대신 SCHEDULE 탭이 **승인된** CLOSE를, 그림자 모드에서는 최근 7일 안에 "승인했을 것"으로 표시한 것을 "LINEAR에서 직접 DONE" 아래에 이슈·PR 링크와 함께 보인다.
  - SUPERVISOR가 Done으로 옮기면 다음 브리핑에서 빠진다.
- **근거 댓글: 일부러 만들지 않았다.** `save_comment`(`[OCC S-xxxx] PR … 머지됨`)만 release하면 OCC의 계획 필드 안에 머문다. 하지만 SUPERVISOR가 바로 뒤에 손으로 닫고, PR은 GitHub 연동으로 이미 연결돼 있고, 닫는 이슈마다 봇 댓글이 붙으면 소음이 된다. 권장은 SUPERVISOR가 이슈 자체에 감사 기록을 원하지 않는 한 끄는 것이다. 만든다면 `callsOf`에서 댓글 하나짜리 CALL 목록이 된다.
- **나중을 위한 스위치.** vocado 규칙이 바뀌어 OCC가 이슈를 닫을 수 있게 되면, 바꿀 곳은 `callsOf` 하나다. `save_issue {id, state: "Done"}`과 근거 댓글을 돌려주고, 거부 상수 `CLOSE_RELEASE_WHY`를 없앤다. 나머지(초안, 판정, linear-guard)는 바꿀 것이 없다.

### 5.6 WAYPOINT gap (2026-09-27 구현, ATC-8)

2026-09-27에 VOC Todo는 6건이었고 배정할 수 있는 것이 없어 DISPATCH 게이트에 새 제안이 쌓이지 않았다. ROUTE MAP은 WAYPOINT마다 완료 기준과 이슈를 이미 알고 있으니([routes.ko.md](routes.ko.md)), 덮는 이슈가 없는 기준을 `NEW` 초안으로 올린다. 지금은 SCHEDULE 게이트를 채우고, S2에서 이슈가 만들어지면 DISPATCH로 이어진다.

- **데이터.** `schedule brief`에 `waypointGaps`가 있다(`server/waypoint-gaps.ts`, 순수 함수 `waypointGapsOf`). 끝나지 않은 ROUTE마다 지금 구간 WAYPOINT와 그다음 WAYPOINT가 있고, 각각 `criteria`("Exit criteria" 아래 번호 목록), 목록이 없으면 `description`, 그 마일스톤의 `issues`(key·제목·상태, 취소·중복 제외), `truncated`가 붙는다. WAYPOINT가 없거나 모두 지난 ROUTE는 뺀다. `candidateTeams` 밖 팀의 마일스톤도 뺀다(atc는 모든 팀의 마일스톤을 읽지만 NEW는 주 팀에 이슈를 만든다). `null`이면 마일스톤을 못 읽은 것이다.
- **판단은 OCC가 한다.** 서버는 기준과 이슈를 짝짓지 않는다. OCC는 바퀴마다 gap을 읽고 열린·끝난 이슈 가운데 어느 것도 덮지 않는 기준을 가린다. 사람이 정할 기준("SUPERVISOR decides", 사용자 모집·인터뷰)과 확인할 끝 조건이 없는 설명은 건너뛰고, **바퀴마다 2건까지** 지금 구간 WAYPOINT부터 올린다(`occ/.claude/skills/tick/schedule.md` "WAYPOINT gap").
- **초안.** `schedule draft NEW --gap --project <ROUTE> --milestone <WAYPOINT> …`. 본문은 DIRECT 형식이고 `## 목표`에 기준을 인용한다. `milestone`은 그 프로젝트의 마일스톤(이름이나 id)인지 검사하고 `changesOf`에 보인다("WAYPOINT Beta Ready"). `--gap`은 마일스톤이 있어야 하고, `similarTickets`가 비슷한 FLIGHT를 찾으면 atc가 받지 않는다. OCC가 놓쳐도 "중복이면 쓰지 않는다"가 지켜진다. gap 초안도 열린 초안 5건 한도에 든다.
- **S2.** 발부된 `save_issue` 호출에 `milestone: <마일스톤 id>`가 들어가 새 이슈가 그 WAYPOINT에 붙는다. linear-guard(`occ/mcp-guard.mjs`, 바꾸지 않음)는 그 입력과 똑같을 때만 통과시킨다. 마일스톤을 빼거나 이름·다른 id를 넣으면 막히는 것을 `occ/mcp-guard.test.mjs`가 확인한다.
- CROSSCHECK는 다른 SCHEDULE 초안처럼 이 초안에도 mark를 단다.

### 5.7 WAYPOINT ETA와 지연 경고 (2026-09-27 만듦, ATC-24)

ROUTE MAP은 이미 WAYPOINT마다 ETA와 지연 여부를 안다([routes.ko.md](routes.ko.md) 5장). 이것을 OCC와 SUPERVISOR에게 가져온다.

- **자료.** `schedule brief`에 `waypointEtas`가 있다(`server/waypoint-slips.ts`, 순수 함수 `waypointEtasOf`). ROUTE마다(ROUTE 이름순, 그 안은 ROUTE MAP 순서) 지나지 않은 WAYPOINT 전부의 `targetDate`, `progress`, `eta`(모르면 `null`과 `reason`), `remaining`, `cumulative`, `late`다. `slips`도 있다. 지연된 WAYPOINT마다 경고 하나이고(`slipOf`, ROUTE MAP의 지연 표시와 같은 조건), `code`, `days`, 한 줄 `text`를 갖는다. 마일스톤을 못 읽었으면 둘 다 `null`이다.
- **코드.** `target-passed`: 목표일이 지났는데 WAYPOINT를 지나지 못함(`days`는 목표일부터 지난 날수). `eta-after-target`: ETA가 목표일보다 늦음(`days`는 늦는 날수). `linear-overdue`: 목표일 없이 Linear가 overdue라 함. 목표일이 지난 것을 먼저 본다.
- **한 번만 보고.** FLIGHT FOLLOWING처럼 경고마다 `key`(`<마일스톤 id>:<code>`)와 `fresh`(아직 보고 안 함)가 있다. `/tick` 5단계에서 OCC는 fresh 경고를 하나에 한 줄로 OCC LOG에 적고 SUPERVISOR에게 보고한 뒤 `atcctl schedule slip-ack`(`POST /api/schedule/slips/ack`)를 실행한다. 보고한 key는 `waypoint-slips.json`에 둔다. 풀린 경고는 잊으니 다시 생기면 다시 fresh다. `eta-after-target`이 `target-passed`가 되면 key가 바뀌어 한 번 더 보고한다. 지연 때문에 팀에 메시지를 보내거나 초안을 쓰지 않는다.
- **화면.** SCHEDULE 탭의 **LATE WAYPOINTS**에 경고가 보인다(코드, ROUTE · WAYPOINT, 목표일, ETA, 날수, OCC가 보고한 때). ROUTE MAP으로 가는 링크가 있다.

### TAIL as built (ATC-68)

`TAIL`은 FLIGHT의 `tail:TEAM_X`(TAIL ASSIGNMENT, [fleet.ko.md](fleet.ko.md))를 AIRCRAFT 하나로 정한다. DISPATCH 밖에서 한 배정이 planner가 지키는 라벨로 남는다.

- **payload.** REGISTRATION 하나(`atcctl schedule draft TAIL <FLIGHT> <TEAM_X> -- <근거>`, 순수 함수 `server/schedule-tail.ts`의 `parseTail`). REGISTRATION이 `teamPattern`에 맞지 않거나, FLEET(`fleet.json`)에 없거나 RETIRED이면, Linear에 `tail:TEAM_X` 라벨이 없으면(읽기 전용 라벨 조회, 10분 캐시, 없으면 한 번 다시 읽음. 사유에 ENGINEERING이나 사용자가 만든다고 적는다. OCC는 만들지 않는다), FLIGHT에 이미 그 `tail:`이 있으면 atc가 초안을 받지 않는다. `CLASSIFY`·`PRIORITIZE`와 달리 닫히지 않은 FLIGHT면 In Progress여도 된다.
- **release.** `save_issue` 하나에 `addLabels: ["tail:TEAM_X"]`, 다른 `tail:`이 있으면 `removeLabels`로 그것들, 그리고 여느 `[OCC S-xxxx]` 댓글. 결과 라벨은 지금 라벨에서 다른 `tail:`을 빼고 새 것을 더한 것이다(`tailLabelsOf`). 나머지 라벨은 옛 `lane:` 별칭까지 그대로 둔다. 상태·담당은 건드리지 않는다. `labels`(전체 교체)가 아니라 `addLabels`·`removeLabels`를 쓰는 까닭: atc 스냅숏은 이슈마다 라벨을 20개까지만 읽고 그룹 라벨을 `type:BUILD`로 보이는데 Linear 이름은 `BUILD`라, 전체 목록을 다시 만들면 라벨을 잃을 수 있다. 다음 조회에 `tail:TEAM_X`가 보이면 APPLIED, FLIGHT가 닫히면 SUPERSEDED.
- **CAUTION.** 다른 팀의 `tail:`을 그 팀이 AIRBORNE이거나 그 FLIGHT의 STAND를 쥔 채 바꾸면 payload에 `caution`이 붙는다(SCHEDULE 카드와 `atcctl` 출력에 보인다). 이런 작업은 자동으로 하지 않는다(7장).
- **출처.** CHARTER DESK의 SUPERVISOR 지시, 그리고 atc 신호. `schedule brief`의 `candidates.tail`은 닫히지 않았고 `tail:`이 없는데 팀이 몰고 있는 FLIGHT이고, 항목마다 `evidence`가 붙는다: `STAND`(그 팀이 FLIGHT의 STAND를 쥠), `DEPARTURE LOG`(최근 7일 `departures.jsonl`에서 마지막으로 적힌 AIRCRAFT), `READBACK`(수락·DEPARTED된 DISPATCH ASSIGN, READBACK된 TOWER CLEARANCE). 초안을 쓸 수 있는 REGISTRATION만 나오고, 열린 `TAIL` 작업이 있는 FLIGHT는 뺀다. atc는 신호로 초안을 쓰지 않는다. OCC가 읽고 판단한다(`occ/.claude/skills/tick/schedule.md` "TAIL 전에").
- **게이트.** `TAIL` 판정은 `CLASSIFY`·`PRIORITIZE`처럼 S2 게이트에 센다. ATFM의 S3 후보는 그대로 `CLASSIFY`뿐이다.
- **8장.** President의 "일 맡기기" 줄과 "President는 물러난다"가 말하는 `TAIL` 작업이 이것이다. 그 줄들의 상태 표시는 머지 뒤 ENGINEERING이 고친다.

### WAYPOINT as built (ATC-77)

`WAYPOINT` 작업은 마일스톤이 없는 FLIGHT를 그 ROUTE의 WAYPOINT(Linear 마일스톤)에 붙인다. 그래야 ROUTE MAP의 WAYPOINT 수·ETA에 잡히고 DISPATCH `waypoint` 가점을 받는다([routes.ko.md](routes.ko.md) 9단계). atc는 마일스톤을 만들거나 이름·순서를 바꾸지 않는다. 이슈의 마일스톤을 정하는 것은 `NEW`의 `milestone`처럼 이슈 수정이다.

- **Payload.** ROUTE와 마일스톤 하나 `{id, name}`(`atcctl schedule draft WAYPOINT <FLIGHT> <마일스톤 이름이나 id> -- <근거>`, `server/schedule-waypoint.ts`의 순수 함수 `parseWaypoint`). FLIGHT가 닫혔거나 프로젝트가 없을 때, 이미 마일스톤이 있을 때, 마일스톤이 그 FLIGHT의 프로젝트 것이 아니거나 지났을(`done`) 때, ROUTE에 이슈 목록이 잘린 마일스톤이 있을 때(소속을 알 수 없다), 마일스톤을 못 읽었을 때 atc가 받지 않는다. 닫히지 않은 FLIGHT면 In Progress여도 된다. 소속은 마일스톤 쪽에서 읽는다(routes.ko.md 원칙 5). 이슈 조회는 그대로다.
- **발부.** `save_issue {id, milestone: <마일스톤 id>}` 하나와 여느 `[OCC S-xxxx]` 댓글. 라벨·상태·담당은 없다. linear-guard(`occ/mcp-guard.mjs`, 그대로)는 그 입력 그대로만 통과시킨다. `occ/mcp-guard.test.mjs`가 id 대신 이름, 다른 FLIGHT, 상태·담당을 얹은 입력이 막히는지 확인한다.
- **닫힘.** 마일스톤(10분 캐시)과 맞춰 본다. 열린 `WAYPOINT` 작업이 있을 때만 읽는다. 발부 뒤 그 마일스톤의 이슈에 FLIGHT가 보이면 APPLIED(발부 전이면 SUPERSEDED). FLIGHT가 닫히거나, 다른 마일스톤에 보이거나, 마일스톤이 없어지거나, 발부 전에 WAYPOINT를 지나면 SUPERSEDED. 마일스톤을 못 읽으면 닫힘과 3일 만료만 본다.
- **후보.** `schedule brief`의 `candidates.waypoint`: 지나지 않은 WAYPOINT가 있는 ROUTE마다 그 WAYPOINT(`id`, `name`, `state`, `targetDate`, `criteria`, 번호 목록이 없으면 `description`)와, 그 ROUTE의 어느 마일스톤에도 없는 후보 팀의 열린 FLIGHT(`flights`). 열린 `WAYPOINT` 작업이 있는 FLIGHT는 뺀다. WAYPOINT가 모두 지난 ROUTE, 잘린 마일스톤이 있는 ROUTE는 후보가 없다. 마일스톤을 못 읽었으면 `null`. atc는 이것으로 초안을 쓰지 않는다. OCC가 FLIGHT를 읽고, 한 WAYPOINT의 완료 기준이 분명히 덮을 때만 한 바퀴 2건까지 쓴다(`occ/.claude/skills/tick/schedule.md` "WAYPOINT 전에").
- **WAYPOINT 없는 ROUTE.** `schedule brief`의 `routesWithoutWaypoints`: 열린 FLIGHT(active·blocked·planned, 상위 이슈 빼고)가 있는데 WAYPOINT가 하나도 없는 ROUTE MAP 행. 항목마다 `open`, `fresh`, `reportedAt`. 읽는 Linear 팀 전부(지연 경고처럼)이고, 마일스톤을 못 읽었으면 `null`. OCC는 fresh ROUTE를 SUPERVISOR에게 한 번 알리고 `atcctl schedule route-ack`(`POST /api/schedule/routes/ack`, ROUTE 이름 `{keys?}`)를 실행한다. 알린 ROUTE는 `routes-without-waypoints.json`에 둔다. WAYPOINT가 생기거나 열린 FLIGHT가 없어지면 잊으니, 다시 그렇게 되면 다시 fresh다. WAYPOINT가 모두 지난 ROUTE는 이 알림에 없다.
- **화면.** SCHEDULE 탭은 `WAYPOINT` 카드를 `PRIORITIZE`처럼 보인다(지금: WAYPOINT 없음과 ROUTE, 바뀜: 그 WAYPOINT, 수동 반영: Milestone). WAYPOINT 후보 목록이 있고, LATE WAYPOINTS 아래에 ROUTES WITHOUT WAYPOINTS가 있다. `WAYPOINT` 판정은 S2 게이트에 센다. ATFM의 S3 후보는 그대로 `CLASSIFY`만이다.
- **되돌리기.** 옛 atc가 `schedule.jsonl`을 읽으면 `TAIL`에서 본 것과 같이 `WAYPOINT` 줄을 건너뛰지 않는다. 모르는 종류를 일반 동기화가 "바꿀 것 없음"으로 보아, 다음 브리핑에 열린 `WAYPOINT` 초안을 SUPERSEDED로(발부된 것은 APPLIED로) 닫는다. Linear에는 쓰지 않는다. 새 `routes-without-waypoints.json`은 그냥 읽지 않는다.

## 6. linear-guard

linear-guard는 `occ/mcp-guard.mjs` 안에 있다. OCC의 MCP 도구 전부에 거는 PreToolUse hook이다(matcher `mcp__.*`, fail-closed `… || exit 2`). 읽기 도구는 S0처럼 통과한다. linear-guard는 Linear 쓰기 도구 둘, `save_issue`와 `save_comment`를 판정한다. 다른 쓰기 도구(관계, 라벨, GitHub)는 S0처럼 모두 막힌다.

Linear 쓰기는 아래를 모두 만족할 때만 통과한다.

1. SCHEDULE 모드가 `approval`이다(S2, 7장). 그림자에서는 Linear 쓰기가 모두 막힌다.
2. 도구와 입력이 atc가 release한 호출과 **정확히** 같다(키 순서는 상관없음). `GET /api/schedule/released`가 `released` 상태인 작업의 호출을 준다. 작업이 APPLIED, SUPERSEDED, EXPIRED가 되면 그 호출은 목록에서 빠진다.
3. 그 호출이 전에 통과한 적이 없다. guard는 쓰기를 통과시키기 직전에 호출을 쓴 것으로 기록한다(claim): `POST /api/schedule/released/claim {tool, input}`이 아직 쓰지 않은, 맞는 release 호출을 찾아 `use` 줄을 남긴다(작업은 `released` 그대로). 똑같은 두 번째 호출은 `… 이미 한 번 통과함`으로 막힌다. 그래서 release된 `save_comment`나 `save_issue`를 되풀이해도 댓글이 두 번 달리거나 이슈가 두 개 생기지 않는다. `GET /api/schedule/released`는 호출마다 `used`를 보인다.
4. atc가 목록과 claim 모두 3초 안에 답한다. 연결할 수 없거나 claim을 기록하지 않으면 쓰기를 막는다.

guard는 이것 말고는 보지 않는다. 나머지는 release되는 호출을 atc만 만든다는 데서 나온다(`callsOf`, "S2 켜는 법" 참고). 이슈 본문은 `— OCC S-0001 · CHARTER REQUEST …`로 끝나고, 댓글은 `[OCC S-0001]`로 시작한다. 어느 호출도 상태나 담당자를 건드리지 않는다. 그래서 이슈를 In Progress나 In Review로 옮기는 쓰기는 맞을 수가 없다.

그 밖에는 모두 `OCC MCP 차단 — …`으로 막힌다. send-guard처럼 OCC는 막힌 쓰기를 말만 바꿔 다시 시도하지 않는다. SUPERVISOR에게 보고한다.

쓴 호출은 계속 쓴 것으로 남는다. 작업을 다시 release해도 같은 호출과 같은 `used` 표시가 돌아오고, 표시를 지우는 길은 없다. guard를 통과한 뒤 Linear 쓰기가 실패했으면 OCC가 보고하고 SUPERVISOR가 Linear에서 직접 바꾼다. 다음 조회에서 바뀐 것이 보이면 atc가 여전히 APPLIED로 표시한다(아니면 3일 뒤 만료).

다음 Linear 조회에 변경이 보이면 atc가 release된 작업을 APPLIED로 표시한다. `NEW`는 초안 뒤에 만들어진 같은 제목(정규화)의 이슈, `CLASSIFY`와 `PRIORITIZE`는 초안대로 된 라벨이나 우선순위, `TAIL`은 초안의 `tail:` 라벨, `CLOSE`는 Done이나 Canceled가 된 이슈다. release 전에 이미 변경이 보이면 APPLIED가 아니라 SUPERSEDED다.

## 7. 흐름과 단계

```
S1 그림자    OCC 초안 → atc SCHEDULE 탭 → SUPERVISOR가 "승인했을 것 / 거절했을 것(사유)" 표시
             Linear에는 아무것도 쓰지 않음. 합의율만 잰다
S2 승인      SUPERVISOR 승인 → OCC: atcctl schedule release S-0001 → 정확한 payload
             → Linear 쓰기(linear-guard) → atc: 다음 조회에서 APPLIED
S3 자동      위험 낮은 작업은 승인을 건너뜀(아래 목록). 나머지는 S2 그대로
```

S1의 작업 상태(`server/schedule.ts`에 구현된 대로): `draft → (agreed | disagreed)`. 곁가지로 `superseded`(같은 FLIGHT·종류의 새 초안이 생겼거나 상황이 바뀜: FLIGHT가 Todo나 Backlog를 떠났거나, 누가 손으로 바꿔서 Linear에 이미 변경이 보임)와 `expired`(판정 없이 3일)가 있다. S2는 `approved → released → applied`를 더하고, 곁가지로 `rejected`를 둔다(`mode` 뒤에 구현). 승인되거나 release된 작업도 `superseded`나 `expired`(release나 적용 없이 3일)가 될 수 있다.

S3 자동 작업 후보. 각각 S2 데이터로 확인한다.

- 이슈의 PR이 머지됐고, 완료 기준을 모두 확인했고, 근거가 연결돼 있으면 `CLOSE`로 Done. vocado 규칙이 바뀌어 OCC가 상태를 바꿀 수 있을 때만이다(5.5). 그전에는 `CLOSE`를 release하지 않으므로 자동도 될 수 없다
- 본문에서 그대로 인용한 선행 작업에 대한 `LINK`
- 상위의 우선순위를 물려받는 `SPLIT` 하위에 대한 `PRIORITIZE`

절대 자동이 아닌 것: CAUTION이 붙은 것, `Canceled`, 무엇이든 지우기, `rating:SEC` 더하기·빼기, AIRBORNE인 다른 팀의 `tail:` 바꾸기.

## 8. DISPATCH와 President를 OCC로 합치기

| 원래 | OCC에서 |
|---|---|
| DISPATCH 세션(`atc/dispatch/`) | 같은 일을 `atc/occ/`에서: 제안 검토, HOLD, FLIGHT PLAN, READBACK. DISPATCH 탭, 제안 id(`D-xxxx`), send-guard는 그대로 |
| President: 일 맡기기 | DISPATCH 제안. 2b 전까지는 사람이 직접 한 배정을 `tail:TEAM_X` 라벨로 기록해서 planner가 볼 수 있게 한다. OCC가 SCHEDULE `TAIL` 작업으로 초안을 쓴다("TAIL as built", ATC-68). S2가 초안을 발부하기 전까지는 라벨을 손으로 붙인다 |
| President: 팀 보고 확인 | **운항 추적**(flight following). atc가 배정된 FLIGHT를 모두 따라간다(`server/following.ts`, `GET /api/following`): 수락·출발·RECALL 중인 DISPATCH ASSIGN, 그리고 `tail:` 라벨이 붙은 In Progress FLIGHT. READBACK → DEPARTED → PR 열림 → CLEARED → ARRIVED 단계를 따라가고(STAND 없는 FLIGHT는 READBACK → DEPARTED → ARRIVED, 8.1), 지연(WAKE 기대치의 1.5배가 지나도 다음 단계가 없음)과 Linear·PR 불일치를 표시한다. OCC는 바퀴마다 `atcctl following`을 돌려 새 문제만 보고하고 `following ack`로 기록해서, 같은 것을 두 번 보고하지 않는다. 팀에 메시지를 보내지 않는다. 팀 보고나 SUPERVISOR 요청이 오면 OCC는 여전히 읽기 전용 `gh`(`gh pr view`, `gh pr checks`, `gh pr diff`)로 PR head, CI, 리뷰를 확인한다. 기계적인 착륙 점검은 ATC의 CLEARED TO LAND(9장)다 |
| President: Linear 정리 | SCHEDULE 작업 |
| President: 규칙 파일 관리 | TEAM이 PR로 구현하는 `NEW` 티켓 |
| President: PR 리뷰와 범위 판단 | SUPERVISOR에게 남는다. OCC는 요약할 수 있지만 결정하지 않는다 |

OCC의 guard는 TOWER의 Bash guard에 읽기 전용 `gh` 하위 명령을 더한 것이다(`guard.mjs --gh-read`). Edit과 Write는 계속 거부된다. `occ/mcp-guard.mjs`는 읽기 MCP 도구(이름이 get, list, search, read, query, fetch로 시작)만 통과시킨다. 그래서 S0에서는 커넥터가 로드돼 있어도 OCC가 Linear나 GitHub에 쓸 수 없다. S2에서는 linear-guard가 승인된 작업의 release된 호출에 한해 Linear 쓰기를 연다(6장).

세션은 매뉴얼을 다시 읽는다. `/tick`은 `atcctl manual check`로 시작한다. `CLAUDE.md`, `/tick`, 그 절차 파일(`.claude/skills/tick/`의 한국어 `*.md` 모두)의 해시를 마지막 `atcctl manual ack`(`~/.local/state/atc/manuals/`에 저장)와 비교한다. 바뀌었으면 세션은 다른 일보다 먼저 다시 읽는다. TOWER의 `/tick`도 같다. OCC의 `CLAUDE.md`에는 핵심(역할, 하지 않는 것, 늘 쓰는 명령, 검토 기준)만 두고, 절차(BRIEFING, FLIGHT PLAN, CREW CHANGE, SCHEDULE, 운항 추적)는 `/tick` 옆 파일로 두어 할 일이 있는 단계에서만 읽는다. 늘 읽히는 규정이 짧게 유지된다(ATC-9). 1장의 옛 매뉴얼 사건은 이것으로 고쳐진다.

**President는 물러난다.** 세 가지가 모두 되면: OCC가 S1을 일주일 운용했고, 운항 추적이 모든 팀 보고를 다루고, `TAIL` 작업을 쓰고 있다(ATC-68로 구현, S2를 켜면 라벨을 쓴다). 그때까지 President는 계속 일을 맡기고, 배정마다 `tail:` 라벨을 손으로 붙인다.

### 8.1 운항 추적 자세히

| 단계 | 출처 |
|---|---|
| READBACK | 제안의 `timeline.accepted` (`tail:` FLIGHT에는 없음) |
| DEPARTED | `timeline.departed`, 없으면 그 FLIGHT의 첫 출발 기록(`departures.jsonl`) |
| PR 열림 | 그 FLIGHT의 열린 PR(`snapshot.pulls`), 없으면 LOGBOOK 항목(머지 시각에서 착륙 대기를 뺀 값) |
| CLEARED | CLEARED TO LAND인 동안 열린 PR의 `readyAt` |
| ARRIVED | 그 FLIGHT의 LOGBOOK 항목(되돌리지 않은 것) |

**STAND 없는 FLIGHT**(SURVEY와 CHECK: 제안이 READBACK으로 DEPARTED함, `departedVia: "readback"`)는 PR을 만들지 않는다. PR 열림과 CLEARED 단계를 건너뛰므로 단계 막대는 READBACK → DEPARTED → ARRIVED다.

| 단계 | 출처 |
|---|---|
| READBACK | 제안의 `timeline.accepted` |
| DEPARTED | 제안의 `timeline.departed`(READBACK 자체) |
| ARRIVED | 제안의 `arrived` 상태(`timeline.arrived`, `arrivedNote` / `arrivedUrl`). CAPTAIN의 보고이고, OCC가 `atcctl dispatch arrived D-xxxx -- <결과 링크나 한 줄>`로 기록한다 |

제안이 없는 `tail:` FLIGHT는 FLIGHT TYPE이 SURVEY나 CHECK이면 STAND 없는 FLIGHT로 본다. 이때 DEPARTED는 Linear 시작 시각, ARRIVED는 Linear Done이다.

| 문제 | 언제 | 심각도 |
|---|---|---|
| `no-departure` | READBACK 뒤 WAKE 기대치의 1.5배(LOGBOOK과 같이 L 60분, M 240분, H 2일)가 지나도 STAND도 출발도 없음 | warn |
| `no-pr` | STAND나 출발이 있는데 1.5배가 지나도 PR 없음 | warn |
| `pr-not-cleared` | PR이 있는데 1.5배가 지나도 CLEARED가 아님. 문구에 착륙을 막는 것들을 적는다 | warn |
| `landing-wait` | CLEARED가 된 뒤 1시간 넘게 착륙하지 않음. 착륙은 SUPERVISOR 몫이다 | info |
| `no-arrival` | STAND 없는 FLIGHT만: DEPARTED 뒤 WAKE 기대치의 1.5배가 지나도 ARRIVED 없음 | warn |
| `review-no-pr` | Linear는 In Review인데 PR이 없음 | warn |
| `done-not-merged` | Linear는 Done인데 머지된 PR이 없음 | warn |
| `merged-not-done` | PR은 머지됐는데 Linear가 Done이 아님. `CLOSE` 초안이 다루는 경우다 | info |

- RECALL 중인 FLIGHT는 멈추라고 한 것이라 지연을 보지 않는다.
- STAND 없는 FLIGHT에는 `no-departure`, `no-pr`, `pr-not-cleared`, `landing-wait`를 쓰지 않는다. Linear·PR 불일치(`review-no-pr`, `done-not-merged`, `merged-not-done`)도 보지 않는다. 지연은 `no-arrival` 하나다.
- ARRIVED했고 Linear에서도 닫힌 FLIGHT는 하루 동안 보이고 빠진다. STAND 없는 FLIGHT도 다른 것처럼 ARRIVED 뒤 하루 동안 보인다.
- `following-state.json`은 OCC가 보고한 키(`FLIGHT|code`)를 가진다. 풀린 문제는 잊으므로, 다시 생기면 다시 보고한다.

### 8.2 tick의 BRIEFING (ATC-4)

`/tick` 3단계에서 OCC는 검토 메모와 별도로, BRIEFING이 없는 열린·HELD 제안마다 `atcctl dispatch briefing <D-xxxx> --what '…' --why '…' --risk '…'`로 쉬운 한국어 세 문장(무슨 일, 왜 이 AIRCRAFT, 걸리는 점)을 쓴다. HOLD를 걸거나 풀 때, 또는 바뀐 본문을 다시 읽었을 때는 다시 쓴다. 숫자(PRIORITY, 대기 일수, ROUTE·WAYPOINT, 선행, 최근 FLIGHT)는 서버가 `briefs.<ID>.facts`로 주니, BRIEFING은 그것을 되풀이하지 않고 뜻을 풀어 쓴다. 카드는 docs/dispatch.ko.md 5.5를 본다.

## 9. ATC가 맡는 것

- **CLEARED TO LAND**(구현): LANDING SEQUENCE 항목은 아래를 모두 만족할 때만 준비됨으로 표시된다.
  - PR의 정확한 head에서 필수 check가 초록이다.
  - 그 head에 통과한 리뷰가 있다(Codex는 head 뒤의 👍. Codex의 COMMENTED 리뷰는 지적이 있다는 뜻이다).
  - base drift가 없다.
  - LOS가 없다.

  지금 President가 손으로 확인하는 것의 기계적인 절반이다. 옛 커밋에서만 초록인 CI, 옛 커밋에 남은 리뷰, main에서 벌어진 것을 잡는다.
- **흐름 관리(3단계)**: CI가 밀릴 때 merge slot과 ground stop. [atfm.ko.md](atfm.ko.md)에 설계돼 있고 일부는 구현됐다(그림자 운용, 그 문서의 상태 줄 참고).
- ATC는 계속 Linear를 읽기만 한다. SCHEDULE 작업 초안을 쓰지 않는다.

### 9.1 구현된 CLEARED TO LAND (2026-09-26)

출처: `server/sources/github.ts`가 git remote가 GitHub에 있는 열린 AIRPORT마다 `gh pr list --repo <owner/name> --state open --limit 100 --json …`을 돌린다. 백그라운드에서 90초마다(`execFile`, shell 없음).
- 실패한 저장소는 마지막 결과를 유지하고, 오류는 스냅숏의 `github` 필드에 보인다. 스냅숏은 `gh`를 기다리지 않는다.
- 판정은 순수 함수다(`server/landing.ts`, 테스트는 `landing.test.ts`).
- PR은 브랜치 이름의 `voc-(\d+)`로 FLIGHT에, 그 브랜치를 체크아웃한 워크트리로 STAND에 이어진다.

| 조건 | 판정 | 이유 |
|---|---|---|
| Check | head의 `statusCheckRollup`이 비어 있지 않고 모든 check가 통과해야 한다. NEUTRAL과 SKIPPED는 통과다. 끝나지 않은 것은 `checks-pending`, 그 밖의 결론(그리고 StatusContext FAILURE / ERROR)은 `checks-failed`다. 다시 돌린 check는 가장 최근 실행만 센다. **모든 check를 필수로 본다** | 어느 check가 필수인지 알려면 폴링 때마다 PR마다 `gh pr checks --required`를 불러야 한다(vocado만 열린 PR이 20건쯤). vocado의 check 셋(Database security contract, core-sync-check, Vercel)은 어차피 머지 전에 다 중요하다. 자주 실패하는 선택 check를 더하는 저장소가 생기면 다시 본다 |
| Check 없음 | 막는다(`no-checks`) | CLEARED는 기계적으로 확인됐다는 뜻이다. check가 없는 PR은 증거가 없다. push 직후 check가 등록되기 전 몇 초도 이것으로 다룬다. 결과: CI가 없는 저장소(지금은 atc 자신)는 CLEARED TO LAND가 되지 않고, 전처럼 SUPERVISOR가 손으로 정한다 |
| 리뷰 | `commit.oid`가 head와 같고, 상태가 APPROVED나 COMMENTED이고, PR 작성자도 Codex 봇(`server/landing.ts`의 `CODEX_BOTS`)도 아닌 사람이 남긴 리뷰. **또는** head 커밋의 committer date 이후에 Codex 봇이 PR에 남긴 `+1` 반응. Codex 리뷰는 절대 통과가 아니다. head에 Codex COMMENTED 리뷰가 있으면 PR은 막힌다(`review-findings`, "Codex 지적 있음(head sha7) — 반영 후 재리뷰 필요"). 풀리려면 그 리뷰의 `submittedAt` 뒤에(그리고 head의 committer date 이후에) 만든 Codex 👍이 있거나, 그 리뷰 뒤에 head에 남긴 사람(Codex도 작성자도 아닌)의 APPROVED 리뷰가 있어야 한다. 지적 전의 사람 APPROVED와 사람 COMMENTED는 지적을 풀지 않는다. 옛 커밋만 리뷰됐으면 `review-stale`(옛 Codex 리뷰도 여기서 세므로 문구에 그 커밋이 나온다), 리뷰가 전혀 없으면 `no-review`. head 뒤의 Codex 봇 마지막 PR 댓글이 "usage limits" 안내이면 문구가 "Codex 한도 — 사람 리뷰 필요"가 된다. | 작성자 자신의 COMMENTED 리뷰는 스레드 답글(빈 본문)이지 리뷰가 아니다. Codex는 문제를 찾았을 때만 COMMENTED 리뷰("💡 Codex Review · Here are some automated review suggestions"와 P1/P2 인라인 댓글)를 남긴다(vocado 389, 393, 400). 깨끗한 PR에는 리뷰 없이 👍만 남긴다(머지된 PR 377, 378, 393, 400에서 확인, 👍은 head 커밋 몇 분 뒤). Codex의 COMMENTED 리뷰를 통과로 세면, Codex가 수정을 요청한 바로 그때 PR이 CLEARED가 됐다. 지적 뒤의 사람 APPROVED는 사람이 지적을 판단했다는 뜻이다(예: 오탐, 또는 Codex가 usage limit에 걸려 다시 리뷰할 수 없음). 반응은 커밋에 묶이지 않으므로 committer date와 지적의 `submittedAt`으로 잇는다. 새 head나 지적보다 먼저 남은 👍은 세지 않는다. 한계: committer date는 push 시각이 아니므로, 👍보다 먼저 커밋하고 뒤에 push한 커밋은 잘못 셀 수 있다. 또 Codex가 다시 리뷰한 뒤 새 👍을 더하지 않고 옛 👍을 둔다면 새 head는 `no-review`로 보인다. 다른 댓글과 반응은 세지 않는다. 반응, head의 committer date, Codex 댓글은 head 리뷰가 통과하지 않았거나, head에 Codex 지적이 있고 그 뒤 사람 APPROVED가 풀지 않은 Draft 아닌 PR에 대해서만 가져온다(`gh api`, 읽기 전용). committer date는 sha마다 캐시하고, 이미 head를 통과시킨 👍은 다시 가져오지 않는다(그 head에 더 새 지적이 오지 않는 한) |
| 변경 요청 | 어느 리뷰어든 마지막 판정(APPROVED / CHANGES_REQUESTED / DISMISSED, COMMENTED는 무시)이 CHANGES_REQUESTED이면, 어느 커밋이든 막는다(`changes-requested`). `reviewDecision`이 그렇다고 해도 막는다 | GitHub이 리뷰어가 승인하거나 dismiss할 때까지 변경 요청을 열어 두는 방식과 맞춘다 |
| Base drift | `mergeStateStatus` CLEAN, UNSTABLE, HAS_HOOKS는 통과. BEHIND(`behind`), DIRTY(`dirty`), BLOCKED(`blocked`), UNKNOWN(`merge-unknown`, "GitHub이 아직 계산 중")은 막는다. DRAFT는 Draft 조건에 맡긴다 | UNSTABLE은 통과 못 한 check가 있지만 머지할 수 있다는 뜻이고, 그 check는 check 조건이 이미 짚는다. HAS_HOOKS는 CLEAN에 서버 hook이 더해진 것이다. BEHIND는 base 브랜치가 최신 상태를 요구할 때만 나온다(vocado는 요구한다) |
| Draft | 막는다(`draft`). Draft는 `pulls`에는 있지만 **LANDING SEQUENCE에는 없다**(브리핑, 이벤트, 샘플) | Draft는 착륙을 청하지 않았다. vocado Draft 15건을 TOWER에 늘어놓으면 소음만 된다 |
| LOS | PR의 STAND에 열린 `conflict` 경보가 있으면 막는다(`los`) | 두 팀이 같은 워크트리에서 일하는 동안 머지하면 커밋을 잃는다 |

**사람의 COMMENTED 리뷰는 여전히 통과다**: Codex도 작성자도 아닌 리뷰어가 head에 CHANGES_REQUESTED가 아닌 COMMENTED를 남겼다면 막지 않기로 한 것이다. COMMENTED로 지적을 전하는 것은 Codex뿐이다.

순서: CLEARED PR은 `readyAt` 순이다. `readyAt`은 그 head에서 모든 조건이 처음 맞은 시각이다(메모리에 `repo#number@head` 키로 둔다. 새 push면 처음부터 다시, 같은 head에서 잠깐 막혔다 풀리면 원래 시각 유지). 그다음 APPROACH PR이 `createdAt` 순이다. TOWER는 이 순서(`seq`)로 `LAND` 번호를 매긴다.

**Linear `Ready to Merge`**: `ATC_LANDING_STATE` 설정과 함께 없앴다. vocado Linear에는 그런 상태가 없고, 점검에 필요한 것은 PR에 다 있고, 쓰지 않는 설정을 두면 헷갈린다. 팀이 `Ready to Merge`라는 Linear 상태를 더하면 FIDS는 여전히 CLEARED TO LAND로 보인다.

**CAPTAIN에게 알리기**: TOWER는 `REPORT`가 아니라 `INFO`를 보낸다.
- 막힌 점은 CAPTAIN을 위한 정보이고, 어떻게 고칠지는 CAPTAIN이 정한다. `REPORT`는 상태 보고를 되돌려 달라는 것인데, atc가 PR을 직접 보므로 TOWER에게는 필요 없다.
- 반복을 막으려고, atc는 CAPTAIN이 손써야 하는 막힘이 새로 생길 때만 `landing.blocked`를 낸다. `checks-pending`, `merge-unknown`, `los`는 세지 않는다. 앞의 둘은 기다리면 풀리고, LOS는 자기 경보가 있다.
- TOWER는 그런 이벤트마다 `INFO`를 최대 한 번 보내고, 서버가 재시작한 뒤에는 보내지 않는다.

### 9.2 Codex를 쓸 수 없을 때 착륙 리뷰 (ATC-7, 2026-09-27. 리뷰어와 제외 규칙은 ATC-27에서 바뀜)

2026-09-27에 vocado PR 17개(#366–#399)가 CI는 초록인데 Codex가 "You have reached your Codex usage limits"로 답해 26–49시간째 APPROACH에 서 있었다. ATC-7은 CROSSCHECK(Muse)의 리뷰가 Codex를 대신하게 했다. 그런데 제외 규칙이 Linear 라벨만 보았고 VOC FLIGHT에는 라벨이 거의 없어서(S1이 쓰지 않는다), 보안 diff 7개(#382, #388, #391, #395–#398)가 Muse로 나갔고 그중 4개(#391, #396, #397, #398)는 Muse pass만으로 CLEARED가 됐다. ATC-27에서 고쳤다: SUPERVISOR는 착륙 리뷰를 **DeepSeek V4.1 Flash**의 별도 세션으로 옮기고, 제외를 라벨이 아니라 diff와 글로도 보게 했다.

- **CODEX UNAVAILABLE**(`codexUnavailableOf`, `server/landing.ts`): 현재 head에 Codex 리뷰(Codex 지적, head 뒤 Codex 👍)도 사람 통과 리뷰도 없고, head 뒤에 Codex 봇이 한도 댓글을 남겼거나(`why: "limit"`), head 커밋과 PR을 연 때 중 늦은 쪽부터 `ATC_CODEX_SILENT_HOURS`(기본 6)시간 동안 Codex 신호가 없는(`why: "silent"`) PR. 한도가 아닌 Codex 댓글이 오면 기다림은 다시 센다. Draft는 Codex 신호를 읽지 않으므로 해당하지 않는다. PR에는 `codexUnavailable`과 `extReview`(`excluded`, `waiting`, `pass`, `findings`)가 붙고, TOWER 브리핑의 `landingQueue`에는 `codex`, `extReview`, `review`(착륙 리뷰로 CLEARED가 됐을 때 리뷰어, 예: `"DEEPSEEK"`)가 있다.
- **리뷰어**는 [`review/`](../review/README.ko.md)의 REVIEW 세션이다(tmux `atc-review`, `claude-ocx-opencode-go--deepseek-v4.1-flash`로 `ocx claude`). CROSSCHECK와 따로 둔다: CROSSCHECK는 DISPATCH·SCHEDULE mark에 Muse를 계속 써서 계열별 수치가 섞이지 않는다. guard 모드 `controller/guard.mjs --review`는 `atcctl manual`, `landing queue`, `landing review`만 허용하고, 세션 기록의 실제 모델 확인은 DeepSeek V4.1 Flash 이름(`REVIEW_MODELS`)만 통과시킨다. `--crosscheck`는 이제 `landing` 명령을 하나도 허용하지 않는다. 서버도 DeepSeek V4.1 Flash가 아닌 모델의 리뷰를 받지 않는다(`LANDING_REVIEW_MODELS`). `landing-reviews.jsonl`의 옛 Muse 기록은 그대로 둔다.
- **외부 리뷰어에 보내지 않는 PR**(`externalExclusionOf`): vocado 규칙은 요청 자료가 학습에 쓰이므로 기밀 작업을 외부 모델에 보내지 않는다. 라벨이 없어도 **하나라도** 맞으면 뺀다:
  - FLIGHT key가 없음("FLIGHT 없음": FLIGHT가 요청하지 않은 코드는 내보내지 않는다);
  - FLIGHT에 `rating:SEC`, FLIGHT나 PR에 `Risk: Security`·`Risk/Security`·`Security`, `Risk: Rights`·`Rights`, `Risk: Contract`·`Contract`;
  - 바뀐 경로가 `supabase/migrations/`·`supabase/functions/` 아래, `*.sql`, auth·session·admission 코드(`auth`, `oauth`, `authentication…`, `authoriz…`, `session(s)`, `admission`이 경로 조각), RLS·policy 코드, `middleware`, `.env*`·비밀·키·자격 증명 경로(`securityPathOf`);
  - PR 제목·본문이나 FLIGHT 제목(자료를 줄 때는 FLIGHT 본문도)에 security, privilege(s), RLS, grant, revoke, definer, admission, auth, authentication, authorization, ACL, exposure/exposed, "use server", 대문자 `EXECUTE`가 있음(`securityWordOf`).

  atc는 PR 목록과 함께 PR 본문을 읽고, head에 Codex 리뷰가 없는 PR마다 바뀐 경로를 읽어 둔다(`gh api …/pulls/N/files`, head별 캐시). 자료를 주기 직전에 실제 diff와 FLIGHT 본문으로 다시 본다(제외면 403, FLIGHT를 못 읽으면 409). 스트립에 사유가 보인다: "외부 리뷰 제외 — migrations", "— 키워드 revoke" 같은 식이고, 막힘 글은 "Codex 한도 — 외부 리뷰 제외(migrations) — Codex나 SUPERVISOR 리뷰 필요"다.
- **리뷰 자료**: `GET /api/landing/review/:repo/:pr`(`:repo`는 저장소 이름이나 `owner/name`)가 PR 제목·본문(8,000자), FLIGHT의 완료 기준과 금지 사항(Linear 본문에서 완료 기준/Acceptance/Exit criteria/Done when, 금지/Forbidden/Do not/Out of scope 머리글 아래, 본문은 6,000자까지), head SHA, 바뀐 파일, diff(80,000자, 넘으면 줄 경계에서 자르고 `diffTruncated`)를 읽기 전용 `gh pr view`·`gh pr diff`로 읽어 준다. 제외된 PR은 403, Draft·Codex를 쓸 수 있는 PR·head가 바뀐 PR·FLIGHT를 못 읽은 PR은 409. `GET /api/landing/reviews`는 `pending`, `excluded`(사유), 최근 리뷰를 준다(`atcctl landing queue`).
- **리뷰 기록**: `POST /api/landing/review/:repo/:pr {head, verdict, text, model}`이 `landing-reviews.jsonl`에 추가한다(`at, repo, number, head, verdict, text, by, model, family, p0, p1, p2`). head는 지금 head여야 한다(7자 이상 앞부분도 된다). `pass`에는 P2만 적을 수 있고 P0·P1은 안 되며, `findings`에는 P0·P1·P2가 하나 이상 있어야 한다. model은 필수이고 DeepSeek V4.1 Flash여야 한다. REVIEW guard가 세션 기록에서 읽어 `ATC_REVIEW_MODEL`로 붙이고, 계열은 `modelFamily`로 남긴다.
- **착륙 규칙**(`reviewBlocks`): **제외되지 않은** CODEX UNAVAILABLE PR에서, 현재 head의 P0·P1 없는 `pass`는 head 리뷰로 쳐서 CLEARED TO LAND가 될 수 있다. 스트립에는 "REVIEW: DEEPSEEK (Codex 한도)"(또는 "Codex 무응답". 이름은 기록의 계열)로 보인다. 제외된 PR에는 기록이 무엇이든 외부 pass가 근거가 되지 않는다: Muse pass로 CLEARED였던 PR은 APPROACH로 돌아갔다. `findings`는 등급과 리뷰 글이 든 `review-findings` 막힘이 되어("DEEPSEEK 지적(Codex 한도, head abc1234, P0 0 · P1 1 · P2 0): …") TOWER가 Codex 지적처럼 CAPTAIN에게 전한다. 새 head는 새 리뷰가 필요하다. Codex가 돌아와 head를 리뷰하면(👍나 지적) Codex가 이긴다. `changes-requested`는 그대로 막는다.
- guard와 settings를 바꾸므로 이 PR들은 `user` 등급이다.

### 9.3 Codex 지적의 등급: P3만 남은 head는 막지 않는다 (2026-09-27, ATC-28)

vocado #394는 수정 → `@codex review` → 더 작은 새 지적(P2, 그다음 P3) → 수정 → …을 되풀이했다. Codex는 리뷰할 때마다 조금 더 작은 것을 찾는데, 착륙 규칙은 head의 Codex COMMENTED 리뷰를 등급과 상관없이 `review-findings`로 막았다. SUPERVISOR는 P3만 남은 지적은 착륙을 막지 않는다고 정했다.

- **등급**(`findingSeverityOf`, `codexHeadFindingsOf`, `server/landing.ts`): Codex의 인라인 지적에는 배지(`![P2 Badge](https://img.shields.io/badge/P2-yellow…)`)가 붙는다. atc는 Codex 댓글이 현재 head에 달린(`originalCommit` = head) 리뷰 스레드마다 첫 댓글에서 배지를 읽는다. 배지를 읽을 수 없으면 P2로 본다. 이전 커밋의 지적은 세지 않는다.
- **착륙 규칙**(`reviewBlocks`): head의 지적이 모두 P3이고 P3 스레드마다 resolve됐거나 Codex 아닌 사람의 답글이 달렸으면, Codex의 head 리뷰를 리뷰로 치고 `review-findings`로 막지 않는다. P0·P1·P2가 하나라도 있으면 전처럼 막고 수를 보인다: "Codex 지적 있음(head b1c684c, P2 1 · P3 1) — 반영 후 재리뷰 필요". 해결도 답글도 없는 P3가 있으면 "Codex P3 지적 2건 중 1건이 해결·답글 없음 … — 스레드를 resolve하거나 답글을 달면 P3는 착륙을 막지 않음"으로 막는다. 인라인 지적 없는 head 리뷰, atc가 스레드를 못 읽은 경우는 전처럼 막는다. 뒤이은 Codex 👍나 사람 APPROVED는 여전히 풀어 준다.
- **스레드**: atc는 head에 Codex 지적이 있는 PR과 BLOCKED인 PR(Draft 아님)의 리뷰 스레드를 읽는다(`gh api graphql`, `reviewThreads`, 읽기 전용, 매 바퀴, 캐시 없음).
- **BLOCKED 사유**: vocado 보호 규칙 "리뷰 스레드 해결 필수"는 GitHub에서 그대로 적용된다. 해결 안 된 스레드가 있는 BLOCKED PR은 "GitHub 보호 규칙이 머지를 막음 — 해결 안 된 리뷰 스레드 N개(스레드 해결 필수: resolve해야 머지된다)"로 보인다. head에 P2와 P3가 열려 있는 #394가 이 경우다.
- **보이는 곳**: `PullRequest.codexFindings`와 `landingQueue[].codexFindings`(`p0`–`p3`, `unmarked`, `open`, `ok`). 스트립에는 "Codex P3 2건(해결됨) — 착륙 막지 않음", LAND 글 끝에는 "Codex P3 지적 2건은 남아 있음(해결·답글됨, 착륙은 막지 않음)."이 붙는다.

### 9.4 쌓인 PR과 STRANDED 머지 (2026-09-27, ATC-29)

vocado VOC-189/190 스택(#395 → main ← #396 ← #397 ← #398, 각자 바로 아래 브랜치가 base)이 14:41에 아래에서부터 각자 바로 아래 브랜치로 squash 머지됐다. #396의 squash 커밋은 #395 브랜치에 들어갔지만, #397과 #398의 것은 #395가 싣지 않는 중간 브랜치에 남았다. GitHub은 MERGED로, Linear는 VOC-190을 Done으로 보였지만 보안 수정은 main에 없었다. atc는 base가 main이 아닌 #396~#398을 CLEARED로 보였다.

- **STACKED**(`stackOf`, `stackedText`, `server/landing.ts`): base가 저장소의 기본 브랜치(저장소마다 한 번 읽는다, `defaultByRepo`)가 아닌 PR에는 `stacked` 막힘이 붙고 CLEARED가 되지 않는다. 글에는 먼저 들어가야 할 것과 사슬이 있다: "쌓인 PR — #395가 먼저 main에 들어간 뒤 base를 main으로 바꿈 (#395 → #396 → #397 → #398)". 사슬은 base 브랜치를 따라 열린 PR을 내려가고, 그 head를 base로 가진 PR을 따라 올라간다(갈래가 있으면 번호가 작은 쪽). `PullRequest.stack`과 `landingQueue[].stack`(`stacked: true`)에 있다. base 브랜치에 열린 PR이 없으면 base를 바꾸라고만 한다. 기본 브랜치를 모르면 쌓인 PR로 가리지 않는다. 스트립에는 `STACKED #395 → #396 → …`가 뜬다. 나머지에게는 APPROACH 그대로라 TOWER는 LAND를 내지 않는다.
- **STRANDED**(`strandedOf`, `firstReach`, `strandedMessage`, `server/sources/github.ts`): 매 바퀴 atc는 최근 14일 안에 기본 브랜치가 아닌 곳으로 머지된 PR을 읽는다(`gh pr list --state merged`, 모든 base). 그중 FLIGHT key(브랜치, 제목, 본문의 `Fixes`·`Closes`·`Resolves`)가 있는 것마다, 머지 커밋이나 head가 기본 브랜치나 그리로 가는 열린 PR의 head의 조상인지 읽기 전용 `gh api …/compare/<대상>...<커밋>`으로 본다(머지된 PR의 base를 head로 가진 PR을 먼저 본다). 고정된 SHA끼리의 결과는 캐시한다. 어디에도 닿지 않으면 `stranded` 경보가 선다: "STRANDED — #398(VOC-190)이 main에 닿지 않음 — … (Linear는 Done)". Linear가 Done이어도 남고, 커밋이 main이나 그리로 가는 열린 PR에 닿아야 풀린다. 확인이 실패하면 경보를 내지 않는다. TOWER 브리핑의 `open.stranded`에 있고, FLIGHT FOLLOWING은 그 FLIGHT에 `stranded` 문제(warn)를 붙인다(이미 Done이어도).

### 9.5 스위치로 보안 PR도 DeepSeek 리뷰어에게 (2026-09-27, ATC-30)

Codex가 5시간 한도에 걸려 vocado #392(admission 키워드)와 #395(SQL 경로)가 리뷰어 없이 멈췄다. ATC-27이 보안 PR을 모든 외부 리뷰어에서 빼기 때문이다. SUPERVISOR는 비공개 저장소의 vocado 보안 diff가 DeepSeek로 나가는 것을 받아들이고, DeepSeek V4.1 Flash 리뷰어가 이것도 맡게 했다.

- **스위치**: `dispatch.json`의 `externalReview.security`. `"exclude"`(기본, 모르는 값도 exclude)나 `"deepseek"`. 설정 창 AGENTS 탭의 REVIEW 줄에서 경고 "보안 PR diff와 Linear 이슈 본문이 DeepSeek로 나감"과 함께 고친다. `PUT /api/settings {reviewSecurity}`가 원자적으로 쓴다.
- **제외 두 가지**(`externalGateOf`): **hard**는 어느 모드에서든 뺀다: FLIGHT 없음, `.env*`·비밀·키·자격 증명 경로(먼저 본다). **security**는 rating:SEC·Risk 라벨, 보안 경로, 보안 키워드다. `"deepseek"`이면 보안 규칙에만 걸린 PR이 REVIEW 대기열로 간다. `extReview.security`에 사유가 남고, 대기 글은 "보안 PR: …", 스트립은 "REVIEW: DEEPSEEK (보안, Codex 한도)", 지적은 "DEEPSEEK 지적(보안, …)"이며, 자료에 `security`와 더 엄격한 안내가 붙고 기록에 `security: true`가 남는다. 현재 head의 DeepSeek pass는 다른 PR처럼 착륙 근거가 된다.
- Muse는 여전히 착륙 리뷰에 쓰지 않고(서버는 DeepSeek V4.1 Flash만 받는다) guard도 그대로다. REVIEW 규정에 보안 PR 리뷰법(권한, RLS, 인증, 마이그레이션 되돌림, 유출, 불확실하면 P1)을 적었다.

### 9.6 main 병합만 한 head에 리뷰 이어받기 (2026-09-27, ATC-31)

vocado의 `main` 규칙은 최신 main을 요구해서(`strict`) 머지가 있을 때마다 다른 열린 PR이 `behind`가 된다. 팀이 `origin/main`을 브랜치에 병합하면 head가 바뀌고, atc가 인정하던 리뷰는 `review-stale`이 됐다. 2026-09-27에 #394는 18700c1에 DeepSeek pass가 있었는데, 변경이 같은 main 병합 c12b706이 새 리뷰를 1시간 반 기다렸다. SUPERVISOR는 `strict`는 두고, main 병합만 한 head에는 atc가 리뷰를 이어 주기로 정했다.

- **후보**(`mergeOnlyChain`, `sameChange`, `server/sources/github.ts`의 `carryCandidates`): head에 리뷰가 없는 PR(Draft 아님)마다, atc는 head에서 PR 커밋을 거꾸로 따라간다(`gh api …/pulls/N/commits`, head별 캐시). 커밋이 병합이고 나머지 부모가 모두 기본 브랜치에 있는 동안(지금 main SHA와 `compare`) 첫째 부모를 후보 `R`로 모은다. `R`과 head에서 PR 자신의 변경이 같을 때만 후보로 친다: `compare(main...R)`과 `compare(main...head)`의 바뀐 파일, 상태, blob SHA가 같아야 한다(300개 한도나 읽기 실패면 잇지 않는다). PR 파일 안의 충돌을 풀며 main을 병합했으면 blob이 달라져 새 리뷰가 필요하다. 모두 읽기 전용이고 `strict`와 GitHub 설정은 그대로다.
- **무엇을 잇나**(`carriedReviewOf`, 최근 `R`부터): `R`의 사람 `APPROVED`, `R` 커밋 뒤에 달린 Codex 👍, `R`의 DeepSeek 착륙 리뷰 기록(외부 리뷰에서 빠지지 않은 PR만, Muse 기록은 잇지 않음). 지적은 지적으로 잇는다: 뒤 👍로 풀리지 않은 `R`의 Codex COMMENTED 리뷰나 `R`의 DeepSeek `findings`는 head에서 `review-findings`가 된다("Codex 지적이 이전 커밋 18700c1에 남아 있음(그 뒤 main 병합만) — 반영 후 재리뷰 필요").
- **결과**: 이어받은 pass는 리뷰 조건을 채워 CI와 base가 맞으면 곧바로 CLEARED가 된다. REVIEW 대기열에 넣지 않으므로(`extReview` 없음) DeepSeek이 한 번 더 돌지 않는다. `PullRequest.carried`·`landingQueue[].carried`(`from`, `by`, `findings`), 스트립 "REVIEW: DEEPSEEK (carried from 18700c1, main merge only)", `landing.cleared` 이벤트의 `carriedFrom`.

### 9.7 AUTOLAND: CLEARED인데 behind인 PR 갱신, 위임된 PR 머지 (2026-09-28, ATC-34)

vocado `main`의 `strict` 때문에 머지가 있을 때마다 다른 열린 PR이 `behind`가 되고, SUPERVISOR가 PR마다 Update branch → CI 대기 → 머지를 되풀이했다. ATC-31로 main 병합만 한 갱신은 리뷰를 이어받으니 그 대기는 기계 일이다. AUTOLAND가 스위치 하나 뒤에서 그것을 한다.

- **스위치**: `autoland.json`의 `mode`. `"off"`(기본, 모르는 값도 off), `"update"`, `"merge"`. SUPERVISOR만 바꾼다: 설정 창 AGENTS 탭의 AUTOLAND 줄(모드마다 한 줄 경고)이나 `PUT /api/settings {autolandMode}`. 서버는 이 화면에서 온 요청(localhost `Origin`이 있는 JSON)만 받는다. 관제 세션 CLI(`atcctl`)에는 AUTOLAND 명령이 없고 `Origin`도 보내지 않으며, guard가 `curl`을 막는다. 같은 파일에 `airports`(기본 `["VCDO"]`, atc 저장소 자신의 착륙은 범위 밖), `mergeMethod`(기본 `squash`), `applicationCheck`(기본 `Application Check`), SUPERVISOR의 `holds`가 있다.
- **GitHub을 새로 읽을 때마다 한 주기**(90초, `server/autoland-run.ts`). 목록의 AIRPORT마다 할 일은 많아야 하나다(순수 `planAutoland`):
  1. GROUND STOP → 아무것도 안 함.
  2. 갱신한 PR이 비행 중 → 새 head의 CI가 끝날 때까지 기다린다(CLEARED, 다른 막힘, 닫힘. 10분 동안 head가 안 바뀌거나 CI가 90분을 넘으면 포기하고 다음으로).
  3. `merge`: LANDING SEQUENCE 순서로 첫 번째 위임된 CLEARED PR → 머지.
  4. HOLD하지 않은 CLEARED PR이 SUPERVISOR 머지를 기다림 → 대기. 지금 다른 PR을 갱신하면 그 머지 뒤 다시 `behind`가 된다. HOLD하면 runway가 풀린다.
  5. LANDING SEQUENCE 순서로 막힘이 `behind` 하나뿐인 첫 PR → 갱신.
- **update**: `PUT /repos/{o}/{r}/pulls/{n}/update-branch`에 `expected_head_sha`(일반 merge 커밋, force-push 아님). ATC-31이 리뷰를 이어 주니 CI가 통과하면 CLEARED로 돌아온다. Draft, 쌓인 PR, `dirty`, LOS PR은 건드리지 않는다. 거절된 갱신(head가 움직임)은 그 head를 건너뛰고 다음 주기에 새 head로 다시 한다. 다른 실패는 head가 바뀔 때까지 그 head를 건너뛴다.
- **merge**: 위임된 PR은 `mergeExclusionOf`에 걸리지 않는 CLEARED PR 전부다. 제외: SUPERVISOR HOLD(착륙 스트립의 HOLD 버튼), FLIGHT 없음, `rating:SEC`나 `Risk…` 라벨(티켓·PR), 바뀐 파일을 못 읽음(`merge`일 때 atc가 Draft 아닌 PR의 파일을 읽는다), ATC-27 보안 게이트(`.env`·비밀·키 경로, migrations, SQL, auth, session, admission, RLS·policy, middleware, 보안 키워드), HUMAN CHECK를 기다리는 PR, `## UI change` 블록이 없거나 class를 채우지 않은 PR(9.8, ATC-37. 옛 Human Preview 게이트 확인을 바꿨다). 머지 직전에 PR을 다시 읽어(`gh pr view`) head와 제외 목록을 다시 본다. 머지는 `PUT /repos/{o}/{r}/pulls/{n}/merge`에 계획한 head를 `sha`로(`--match-head-commit`의 REST 형태), `merge_method`와 함께. GitHub auto-merge는 켜지 않는다. 제외된 CLEARED PR은 SUPERVISOR에게 남고, HOLD가 아니면 runway를 잡는다.
- **GROUND STOP**: 목록의 AIRPORT에서 기본 브랜치 head의 `applicationCheck` 체크가 실패하면 그 AIRPORT의 두 모드를 멈춘다. main이 다시 초록이 돼도 SUPERVISOR가 풀 때까지(설정 창, 또는 `POST /api/autoland/groundstop/clear {airport}`) 멈춰 있다. 푼 SHA로는 다시 걸지 않고, 새 SHA가 빨가면 다시 건다. 스위치가 꺼져 있어도 걸어 두므로 켤 때 먼저 보인다.
- **기록**: `autoland.jsonl`(추가만): `update`, `merge`, `settle`, `skip`, `groundstop`, `groundstop-clear`, `mode`, `hold`, `unhold`. 줄마다 모드, AIRPORT, PR, head, 결과, 설명. 상태(비행 중, GROUND STOP, 푼 SHA, 건너뛴·머지한 head)는 `autoland-state.json`. `GET /api/autoland`가 설정, 상태, 계획, 최근 기록 50줄을 보인다.
- **화면**: LANDING SEQUENCE 머리에 AIRPORT마다 한 줄("AUTOLAND: updating #383", "AUTOLAND: waiting — #383 CLEARED, …", "AUTOLAND: GROUND STOP — …"). PR마다 AUTOLAND가 할 일이나 안 하는 까닭("AUTOLAND update 대기 2번째", "AUTOLAND 제외 — DIRTY(충돌)", "AUTOLAND 대기 — 리뷰 없음 먼저", "SUPERVISOR 머지 — rating:SEC")과 HOLD 버튼.
- **켜기**: SUPERVISOR가 2026-09-28에 배포 뒤 `update`를 켜기로 정했다. `merge`는 만들어 두고 끈다. vocado `AGENTS.md`가 "Human merge is the final gate"라서, SUPERVISOR가 먼저 거기에 VOC-141 같은 AUTOLAND 예외를 적어야 한다.
- **갱신 뒤 재리뷰(ATC-38)**: 2026-09-28에 AUTOLAND가 #401을 36f36a0으로 갱신했다. #403이 main에서 #401의 파일 둘을 바꿨으니 리뷰가 이어지지 않은 것은 맞다. 하지만 Codex는 그 merge 커밋을 리뷰하지 않았고, REVIEW 인계는 Codex가 6시간 조용해야 해서 TEAM_D가 손으로 `@codex review`를 달았다. 이제 갱신이 끝났는데 새 head가 `no-review`나 `review-stale`이면 atc가 그 head에 한 번 요청한다(`reviewRequestOf`):
  - **Codex를 쓸 수 있으면**(head 뒤에 한도 댓글이 없음): PR 댓글 `@codex review` 하나. AUTOLAND의 GitHub 쓰기는 이것만 더해졌다.
  - **Codex가 한도이거나 30분 안에 답이 없으면**(`escalateOf`): 그 head를 곧바로 REVIEW(DeepSeek) 대기열로 넘긴다(`buildPulls`의 `fastTrack`, `codexUnavailable.why = "autoland"`, "AUTOLAND 재리뷰 — Codex 30분 무응답"). head 뒤에 Codex가 이미 답했으면 넘기지 않는다.
  - ATC-27·30은 그대로다: `buildPulls`가 지금 스위치로 외부 리뷰 제외를 다시 본다. 제외 PR은 대기열에 넣지 않고, 스트립에 "AUTOLAND: SUPERVISOR 리뷰 필요 — 외부 리뷰 제외(migrations)"로 보인다.
  - head마다 한 번(`autoland-state.json`의 `reviewRequests`). 기록은 `op: "review-request"`에 `via`(`codex`, `deepseek`, `supervisor`). 리뷰가 붙을 때까지 스트립에 "AUTOLAND: review requested (codex|deepseek)"가 보인다. AUTOLAND가 `update`나 `merge`이고 그 AIRPORT가 GROUND STOP이 아닐 때만 한다.

### 9.8 HUMAN CHECK: CHOICE·ACCOUNT·DEVICE PR만 사람을 기다린다 (2026-09-28, ATC-37)

ATC-39 리서치([research/human-preview.ko.md](research/human-preview.ko.md)) 뒤로, 사람이 꼭 봐야 하는 UI PR은 세 class뿐이다. 애플리케이션 저장소의 PR 본문에 짧은 `## UI change` 블록이 있고, atc는 거기서 아래 칸만 읽는다.

| 칸 | atc가 읽는 것 |
|---|---|
| `UI impact` | `none` 또는 렌더되는 UI 변경 |
| `Human check class` | `CHOICE`·`ACCOUNT`·`DEVICE` 중 해당하는 것, 또는 `none`. 템플릿 문구를 그대로 두면 채우지 않은 것 |
| `Evidence pack` | 같은 PR의 댓글 링크(`…/pull/<n>#issuecomment-<id>`) |
| `Preview` | ACCOUNT·DEVICE: 현재 head의 Preview URL |
| `Human steps` | ACCOUNT·DEVICE: 1~3 단계(들여쓴 다음 줄까지) |
| `Human check` | `not needed`, `pending`, `done <date> <sha> <note>`·`failed <date> <sha> <note>` |

옛 Human Preview 게이트 절은 전혀 읽지 않는다.

- **대기열**(`waitsOnHuman`): Draft가 아닌 열린 PR 중 블록에 class가 있고 `Human check`가 현재 head에 `done`이 아닌 것. 결과는 head에 묶인다. 적힌 SHA의 head(`sha`가 head의 앞부분)에서 유효하다. 현재 head가 main 병합만으로 닿고 변경이 같은 이전 커밋이어도 유효하다: ATC-31 규칙, `carryFrom`에서 읽고, 리뷰가 이미 head에 있는 PR은 리뷰 판정을 건드리지 않도록 따로 읽은 `humanCarryFrom`에서 읽는다. 그 밖의 SHA면 "옛 head에 기록됨"이다. 현재 head에 `failed`면 대기열에 남는다. class `none`이나 `UI impact: none`은 들지 않는다.
- **줄**(STRIPS, LANDING SEQUENCE 위 `HUMAN CHECK n`): PR, AIRPORT·FLIGHT, STAND를 쥔 팀, class 칩, 상태.
  - 증거: Evidence pack이 가리키는 PR 댓글의 이미지를 썸네일로 보인다. GitHub `body_html`로 읽는데, 거기 서명된 이미지 주소는 private 저장소에서도 열리지만 몇 분이면 만료된다. 그래서 메모리에 3분만 두고 저장하지 않는다. 다른 PR의 댓글 링크는 받지 않는다.
  - 이 head의 RUN-UP 보고서(ATC-41)가 있으면 그것도 보인다: AIRPORT 체크아웃이나 그 STAND의 `.runup/<base7>-<head7>/report.json` 중 `head.sha`가 head인 것. 줄에 바뀐 화면·컷 수, UNEXPECTED 경고, 바뀐 컷 썸네일, 보고서 링크가 붙는다.
  - ACCOUNT·DEVICE면 Preview 링크와 단계.
- **PASS·FAIL**(`POST /api/human-check/:owner/:name/:number {result, head, note}`): SUPERVISOR만, AUTOLAND 스위치와 같은 Origin 규칙. atc가 먼저 PR을 다시 읽는다. 화면이 본 `head`가 지금 head여야 하고, 블록에 class와 `Human check` 줄이 딱 하나 있어야 하고, FAIL은 메모가 있어야 한다(한 줄, 백틱 없이, 200자까지).
  - 그다음 GitHub에 딱 두 번 쓴다. 먼저 PR 본문에서 그 줄만 `` `done <YYYY-MM-DD> <sha7> <note>` ``(또는 `failed`)로 바꾸고(stdin JSON), 그다음 PR 댓글 하나 "HUMAN CHECK: PASS|FAIL · head · class · 날짜"와 메모를 단다.
  - 본문 쓰기가 실패하면 댓글은 달지 않는다. 시도마다 `human-checks.jsonl`(추가만)에 한 줄: 시각, 저장소, PR, head, 결과, class, 메모, `by`, `ok`, `line`, 댓글 URL, 오류.
  - Vercel 공유 토큰은 만들지도 두지도 않는다.
- **착륙**(9.7의 Human Preview 제외를 바꾼다): AUTOLAND `merge`는 class PR을 `Human check`가 이 head에 `done`일 때까지 머지하지 않는다(머지 직전에 다시 본다). 블록이 없거나 `UI impact`가 `none`이 아닌데 class를 채우지 않은 PR도 머지하지 않는다: 사람이 필요한지 알 수 없다. class `none` PR은 막지 않는다. LANDING SEQUENCE 줄에는 class PR마다 `HUMAN CHECK <class>: <상태>`가 붙는다. CLEARED TO LAND 조건은 그대로다.
- **API**:
  - `GET /api/human-check`: 대기열과 최근 기록 50줄.
  - `GET /api/human-check/:owner/:name/:number/evidence`: 댓글 이미지와 RUN-UP 요약.
  - `GET /api/human-check/:owner/:name/:number/runup/:run/<파일>`: RUN-UP 보고서 파일. symlink를 풀어 본 뒤 그 보고서 폴더 안의 파일만, `.html`·`.json`·이미지·`.css`·`.js`만 보낸다. `Content-Security-Policy: sandbox allow-scripts`로 보내므로 보고서의 스크립트는 불투명한 출처에서 돌아 atc의 SUPERVISOR 전용 API를 부를 수 없다.
- 순수 함수는 `server/human-check.ts`(`uiChangeOf`, `humanCheckStatusOf`, `humanCheckExclusionOf`, `setHumanCheckLine`, `checkRequestOf`, `imagesOf`, `pickRunup`), 입출력은 `server/human-check-run.ts`.

## 10. atc에 더할 것

| 곳 | 내용 |
|---|---|
| `server/schedule.ts` (새 파일) | SCHEDULE 기록(`~/.local/state/atc/schedule.jsonl`, 추가만 함), 상태 전이, Linear 조회로 APPLIED 감지, 열린 초안 한도(하루 한도는 아직 만들지 않음) |
| `server/sources/linear.ts` | 라벨(`tail:`, `type:`, `wake:`, `rating:`), 최근 닫힌 이슈(중복 검색용) 읽기. NEW의 APPLIED는 `S-xxxx` footer가 아니라 제목으로 감지한다(6장) |
| `server/dispatch.ts` | `tail:TEAM_X`와 [fleet.ko.md](fleet.ko.md) 5장의 분류 규칙 따르기 |
| API | `GET /api/schedule/brief`, `GET /api/schedule/ops/:id`, `POST /api/schedule/ops`(초안), `POST /api/schedule/ops/:id/{verdict,approve,reject,release}`, `POST /api/schedule/mode`, `POST /api/schedule/slips/ack`, `POST /api/schedule/routes/ack` |
| `atc/occ/` | `atc/dispatch/`에서 옮김: `CLAUDE.md`(운영 매뉴얼의 핵심), `/tick`과 그 절차 파일, send-guard, **linear-guard**, 읽기 전용 `gh`가 있는 Bash guard |
| `controller/atcctl.mjs` | `schedule draft`, `schedule release`, `schedule brief` |
| 화면 | SCHEDULE 탭: 이유·payload 미리보기·중복 검색 결과가 있는 초안, 판정·승인 버튼, 적용 이력 |
| 기록 | FLIGHT RECORDER에 `schedule.drafted / decided / released / applied`. 지표: 합의율, 사람이 되돌린 작업, 주당 만든 티켓 |

## S2 켜는 법

S2는 구현돼 있고 SCHEDULE `mode`(`~/.local/state/atc/schedule.json`, 기본 `shadow`) 뒤에 있다. 켜면 OCC가 승인된 작업을 Linear에 쓰므로 이 순서로 한다.

1. SCHEDULE 탭에서 S2 게이트(그림자 판정 20건 이상, 합의율 80% 이상)를 확인한다. atc가 보이는 게이트(`gateOf`)는 이 둘만 본다. 11장의 "나중에 발견된 중복 0건"은 atc가 세지 않는다(아직 만들지 않음).
2. vocado `CLAUDE.md`의 "Linear에는 리더만 쓴다" 규칙을 "OCC와 리더가 Linear에 쓴다. OCC는 계획 필드를(승인된 SCHEDULE 작업으로), 리더는 실행 필드를 쓴다"(4장)로 바꾼다. 그때 SUPERVISOR에게 확인한다.
3. 평평한 Linear 라벨 `rating:SEC`, `rating:UI`, `rating:DATA`, `rating:DOCS`를 만든다(`type`·`wake` 라벨 그룹과 `tail:TEAM_X`는 이미 있다). 없는 라벨을 쓰는 CLASSIFY나 NEW 호출은 실패하고, OCC가 보고한다.
4. SCHEDULE 탭의 "S2 승인 운용 켜기"를 누른다(또는 `POST /api/schedule/mode {"mode":"approval"}`). OCC는 다음 바퀴에 읽는다.
5. 멈추려면 shadow로 되돌린다. 그러면 linear-guard가 Linear 쓰기를 모두 막고, 이미 release한 작업은 그대로 둔다.

돌아가는 방식:

1. SUPERVISOR가 승인한다(또는 사유와 함께 거절한다).
2. OCC가 `atcctl schedule release S-xxxx`를 돌린다. 이 명령은 RELEASED를 기록하고, 정확한 Linear MCP 호출(`save_issue`, CLASSIFY·PRIORITIZE에는 이유를 담은 `save_comment`도)을 출력한다.
3. OCC는 입력을 바꾸지 않고 호출을 하나씩 한다. `occ/mcp-guard.mjs`(linear-guard)는 모드가 approval이고, 도구와 입력이 release된 호출과 정확히 같고, 그 호출이 전에 통과한 적이 없을 때만 Linear 쓰기를 통과시킨다(6장).
4. 다음 Linear 읽기에서 atc가 작업을 APPLIED로 표시한다(변경이 보이거나, NEW이면 그 제목의 이슈가 생김).

승인되거나 release됐는데 3일 안에 적용되지 않은 작업은 만료된다. 호출은 계획 필드만 건드린다: 라벨, 우선순위, 새 이슈의 제목·본문·프로젝트·관계, 댓글. 상태나 담당자는 절대 아니다.

## CROSSCHECK

그림자 판정(DISPATCH 제안과 SCHEDULE 초안)은 SUPERVISOR가 하나씩 정하므로 부담이 크다. 판정을 모델에 넘기면 게이트(판정 20건, 80%)가 모델 둘이 서로 맞는지를 재게 되고, 그건 아무 뜻이 없다. 그래서 일을 나눈다.

- OCC와 다른 계열 모델로 도는 **CROSSCHECK** 세션이 열린 항목마다 먼저 예비 판정(**mark**: `agree`/`disagree`와 한 줄 이유)을 남긴다.
- SUPERVISOR는 한 번 눌러 받아들이거나("CROSSCHECK에 동의"), 전처럼 사유를 달아 뒤집는다.
- 게이트는 계속 **사람 판정만** 센다.
- CROSSCHECK가 사람과 얼마나 맞는지는 따로 잰다. 나중에 위험 낮은 일(예: `SEC`가 아닌 CLASSIFY)을 자동으로 넘길지 정할 근거다. 자동 판정은 구현하지 않았다.

**기록.** `proposals.jsonl`과 `schedule.jsonl`은 `crosscheck` op를 받는다: `{op:"crosscheck", id, at, by, verdict:"agree"|"disagree", reason}`.
- `note`처럼 스스로 상태를 바꾸지 않는다. DISPATCH `disagree`에 FLIGHT 칩이 있으면 서버가 그 옆에 PREFLIGHT HOLD를 건다(아래).
- 제안이 `proposed`이고 HOLD가 아닐 때, 또는 초안이 `draft`일 때만 받는다. 나중 mark가 앞의 것을 대신한다.
- fold는 Proposal과 ScheduleOp에 `crosscheck: {by, verdict, reason, at} | null`을 더한다.
- ScheduleOp에는 `decision: {verdict, at} | null`도 생긴다. SUPERVISOR의 결정이고, 뒤의 상태(released, applied)에서도 남는다.

**API.** `POST /api/dispatch/proposals/:id/crosscheck`와 `POST /api/schedule/ops/:id/crosscheck`, 본문 `{verdict, reason, by?}`. mark는 결정이 아니라 참고이므로 어느 모드에서나 된다. `reason`은 필수이고 500자까지. HOLD 제안이나 닫힌 항목은 409를 돌려준다.

**일치율.** 두 `gateOf` 결과 모두 `crosscheck: {marked, matched, rate}`를 가진다.
- 사람 결정만 센다(그림자 `agreed`/`disagreed`, 승인 `approved`/`rejected`). 그중 결정 전에 mark가 있던 것만.
- `agree`는 `agreed`/`approved`와, `disagree`는 `disagreed`/`rejected`와 맞는다.
- supersede와 expire는 사람 결정이 아니므로 세지 않는다.

**브리핑.** 두 브리핑 모두 `crosscheck: {pending, examples}`를 가진다. mark가 없는 열린 항목, 그리고 보정 예시로 최근 사람 결정 8건까지(사유가 있는 것 먼저)와 그 사유다. 실제 SUPERVISOR 사유는 "이미 완료됨", "PR #393 머지 전이면 HOLD", "우선순위가 미정" 같은 것이다.

**atcctl.** `crosscheck brief`(두 브리핑의 pending, examples, 비율과 거기 나오는 FLIGHT), `dispatch crosscheck D-xxxx agree|disagree -- <reason>`, `schedule crosscheck S-xxxx agree|disagree -- <reason>`.

**PREFLIGHT HOLD**(2026-09-27, ATC-3. [dispatch.ko.md](dispatch.ko.md) 6.2). 시작할 상태가 아닌 제안은 SUPERVISOR 대기열에서 기다리지 않는다:
- CROSSCHECK가 FLIGHT 칩(`already-done`, `parent-issue`, `waiting-on-prior`, `needs-human`, `no-priority`, `out-of-repo`)으로 `disagree`: 서버가 mark 뒤에 `{op:"preflight", id, at, by, model, codes, reason}`을 남기고 제안은 HELD로 간다. CROSSCHECK에는 새 권한이 없고 guard도 그대로다. HOLD는 mark를 받은 서버가 내는 결과다. tick마다 먼저 달린 mark의 열린 제안에도 적용한다. 이때 `atcctl dispatch crosscheck`는 `FLIGHT 칩이라 서버가 PREFLIGHT HOLD`를 출력한다.
- OCC HOLD(`dispatch note … --hold`)는 전처럼 HELD로 간다.
- `wrong-aircraft`, `other`, 칩 없는 mark는 대기열에 남는다. mark가 없는 제안은 `CROSSCHECK 대기`로 표시하고 뒤로 정렬한다.
- HELD 제안에는 SUPERVISOR가 판정하지 않는다(409). "대기열로"(`POST …/requeue`)는 같은 제안을 대기열로 돌리고, OCC는 그것을 다시 HOLD할 수 없다(409). "FLIGHT 보류 확정"(`POST …/confirm-hold`, 선행 HOLD에는 없음)은 `via: "preflight"`와 칩으로 닫아 FLIGHT를 모든 AIRCRAFT에서 24시간(이슈가 바뀌면 그 전까지) 뺀다. 둘 다 게이트와 CROSSCHECK 일치율에 세지 않는다.

**착륙 리뷰는 CROSSCHECK 몫이 아니다**(ATC-27. 9.2): ATC-7부터 ATC-27 전까지 CROSSCHECK(Muse)가 Codex 한도 때 PR diff도 리뷰했다. 이제 DeepSeek V4.1 Flash의 REVIEW 세션(`review/`)으로 옮겼고, `--crosscheck`는 `landing` 명령을 허용하지 않는다. 그래서 CROSSCHECK의 계열별 수치는 DISPATCH·SCHEDULE mark만 센다.

**세션**(`crosscheck/`, `occ/`와 같은 구조): 한국어 `CLAUDE.md`와 `/tick`이 원본이고, `*.en.md`가 번역이다.
- `/tick`: `manual check` → `crosscheck brief` → mark 없는 항목마다 `dispatch flight <key>`로 본문 읽기 → mark 기록(한 바퀴에 최대 5건).
- 규칙: mark는 조언일 뿐이다(승인·거절·판정은 절대 안 함). Linear에 쓰지 않고 누구에게도 메시지를 보내지 않는다. 티켓 상태, 선행 작업, 이미 끝났는지를 먼저 확인한다. OCC 메모는 답이 아니라 참고로 본다. 근거가 부족하면 mark를 남기지 않는다.

`crosscheck/.claude/settings.json`은 fail-closed다.

| 도구 | 규칙 |
|---|---|
| Bash | `controller/guard.mjs --crosscheck --gh-read`: atcctl `manual`, `crosscheck brief`, `dispatch brief\|flight`, `schedule brief`, `crosscheck` 명령 둘, 파이프 뒤의 `jq`만(stdin만: 파일 인자 없음, 옵션 허용 목록, 필터에 `env`·`$ENV`·`import`·`include` 없음. gh의 `--jq`에도 같은 필터 검사), 그리고 읽기 전용 `gh pr view\|checks\|list`(`permissions.allow`에도 허용). 다른 atcctl 명령(note, hold, draft, release, readback …)은 모두 막힌다. 다른 `gh` 사용도 모두 막힌다: `gh pr diff`(CROSSCHECK는 코드를 읽지 않는다. OCC의 `--gh-read`만으로는 여전히 허용), `merge`, `comment`, `review`, `close`, `edit`, `gh api`, `--web`, 이어 붙인 명령과 치환. `--crosscheck`만 있으면 `gh`는 막힌 채다 |
| MCP | `occ/mcp-guard.mjs --read-only`: 읽기 도구만. OCC와 달리 release된 Linear 쓰기도 막는다 |
| Read, Glob, Grep | `crosscheck/` 자신과 atc의 `docs/`만(SUPERVISOR 결정, 2026-09-26). `docs/fleet.md` 4.1–4.3의 분류 기준을 읽고 인용할 수 있게 하려는 것이다. `permissions.additionalDirectories: ["../docs"]`가 추가 디렉터리 하나를 준다(상대 경로 `Read(../docs/**)` allow 규칙은 시험에서 먹지 않았다). fail-closed PreToolUse hook인 `crosscheck/read-guard.mjs`가 나머지를 모두 막는다: atc 소스, `~/.local/state/atc`, 다른 저장소, 다른 세션의 파일, `..`나 절대 경로가 든 Glob 패턴. 대화형 세션(Desktop)도 다룬다. 거기서는 작업 디렉터리 밖을 읽으면 권한 창이 뜨기 때문이다. 세션 자신이 저장한 도구 출력(`<transcript dir>/<session_id>/`)은 읽을 수 있다. 큰 결과가 거기 저장되고 다시 읽히기 때문이다 |
| Edit, Write, NotebookEdit, SendMessage, Agent, Artifact | 거부되고, PreToolUse hook이 exit 2로 끝난다 |

**모델.** OCC 계열(Claude)이면 안 된다. DeepSeek V4.1 Flash도 안 된다. `flash-helper` 뒤의 모델이고, FLEET는 그 모델에 판정을 맡기지 않는다([fleet.ko.md](fleet.ko.md)). 모델 둘을 설정했고, 둘 다 로컬 opencodex 프록시가 제공한다.

| 역할 | 모델 id | 에이전트 파일 |
|---|---|---|
| **기본**(SUPERVISOR 결정, 2026-09-26) | `claude-ocx-opencode-go--muse-spark-1.3-contributor[1m]` (Muse Spark 1.3) | `~/.claude/agents/ocx-muse-spark-1-3-contributor.md` |
| 예비 | `claude-ocx-native--gpt-5.6-terra` (GPT-5.6 Terra) | `~/.claude/agents/ocx-gpt-5-6-terra.md` |

`crosscheck/.claude/settings.json`은 터미널에서 연 세션을 위해 `"model"`을 정한다. mark의 모델 이름은 더 이상 설정에서 정하지 않는다. guard가 실제 모델을 읽는다(아래). `crosscheck/settings.test.mjs`는 설정 모델이 CROSSCHECK 목록(Muse나 Terra) 밖이거나, 설정 `env`에 모델 이름이 있으면 실패한다. 예비로 바꾸려면 `model`을 terra id로 바꾼다.

실행 확인(2026-09-26, Claude Code 2.1.283):

| 실행 | 결과 |
|---|---|
| `claude`(설정 모델 또는 `--agent`) | 두 모델 모두 404 "issue with the selected model". ClaudeRipple 프록시는 `claude-ocx-*`를 라우팅하지 않는다. 안전한 실패다: 조용히 Claude로 돌지 않는다 |
| `ANTHROPIC_BASE_URL`을 export한 `ocx claude` | 404: export한 `ANTHROPIC_*`가 `ocx claude`가 정하는 프록시 URL을 덮는다 |
| `ANTHROPIC_BASE_URL` 없는 `ocx claude` | 405: `~/.claude/settings.json`의 `HTTPS_PROXY`(ClaudeRipple)가 로컬 프록시로 가는 요청을 가로챈다 |
| `env -u ANTHROPIC_BASE_URL NO_PROXY=… ocx claude`, terra | 된다(설정 모델과 `--agent`). `modelUsage`가 `claude-ocx-native--gpt-5.6-terra`를 보고한다. terra로 전체 `/tick`은 아직 돌리지 못했다: 상위 할당량이 바닥났다 |
| 같음, Muse, 기본 도구 | 400 "Invalid JSON schema"(Artifact 도구의 `pattern` 키워드). 설정에서 `Artifact`를 거부해 고쳤다 |
| 같음, Muse, Artifact 거부 | 한 줄 답은 되지만 `/tick`은 두 번째 요청에서 실패한다: 400 "JSON schema exceeds the maximum nesting depth of 10 levels". 첫 요청 뒤에 연결을 마친 MCP 서버가 깊게 중첩된 도구 스키마를 더한다 |
| 같음, Muse, Artifact 거부, `--strict-mcp-config` | 된다: 시험 서버에서 전체 `/tick`이 20턴 동안 항목 3개에 mark를 남겼고, mark마다 Muse id가 남았다 |

그래서 세션은 `crosscheck/`에서 이렇게 연다.

```bash
env -u ANTHROPIC_BASE_URL NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost ocx claude --strict-mcp-config
```

이름은 `CROSSCHECK`, `/loop 10m /tick`으로 돌린다. 설정 창 CONTROL 블록의 CROSSCHECK 줄 **LAUNCH**가 이것을 한 번에 한다(ATC-66, [fleet.ko.md](fleet.ko.md) 8.5.1): `crosscheck/`에서 tmux 세션 `atc-crosscheck`로

```bash
env -u ANTHROPIC_BASE_URL NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost ocx claude --strict-mcp-config -n CROSSCHECK '/loop 10m /tick'
```

`-n`이 세션 이름을 정하고 마지막 인자가 첫 메시지다. 손으로 열 때는 같은 명령을 `tmux new-session -d -s atc-crosscheck -c /home/c10/projects/atc/crosscheck "…"` 안에 넣는다.

**Claude Desktop에서.** Desktop은 설정의 `model`을 따르지 않는다. 앱에서 고른 모델을 쓰고, 그 모델은 ClaudeRipple 프록시(`HTTPS_PROXY` 127.0.0.1:8790)를 거친다. 이 프록시는 Claude 모델도 그대로 통과시킨다. `crosscheck/` 폴더에서 세션을 열고, 이름을 `CROSSCHECK`로 하고, **앱의 모델 메뉴에서 `muse-spark-1.3-contributor`를 고른** 뒤 `/loop 10m /tick`. 2026-09-26에 Desktop 세션 둘이 기본 `claude-opus-5-5`로 돌았는데, mark는 Muse 이름으로 기록됐다(S-0006과 S-0007이 그랬을 가능성이 크다). 이제 아래의 실제 모델 확인이 이것을 막는다.

`--mcp-config` 없는 `--strict-mcp-config`는 MCP 서버를 하나도 로드하지 않는다. 그러면 세션에 MCP 도구가 없다.
- 대신 GitHub은 읽기 전용 `gh pr`로 읽는다(SUPERVISOR 결정, 2026-09-26). OCC와 같은 Bash guard 방식이다.
- 본문, 댓글, OCC 메모가 PR 조건을 말하면(예: "PR #393 머지 전이면 HOLD", "이미 완료됨"), mark 전에 `gh pr view <N> --repo <owner/name> --json state,mergedAt,title`로 사실을 확인한다.
- `crosscheck/CLAUDE.md`가 AIRPORT마다 저장소를 짝지어 둔다(VCDO → `chaehy5665/vocado_nextjs`).
- `occ/mcp-guard.mjs --read-only`는 그대로 둔다.
- 상위 계정이 rate limit에 걸리면 세션은 API 오류로 멈춘다. Claude로 대신 돌지 않는다.

**mark마다 실제 모델.** mark는 Muse나 Terra가 써야 하고, 실제로 쓴 모델을 기록해야 한다. 설정도 프록시도 이것을 증명하지 못한다: Desktop은 설정 모델을 무시하고, ClaudeRipple은 Claude 요청도 넘긴다. 그래서 Bash guard가 세션 자신의 transcript를 확인한다.

- mark 명령(`atcctl dispatch|schedule crosscheck`)이면 `guard.mjs --crosscheck`가 hook 입력의 `transcript_path`(세션 자신의 JSONL, 마지막 4 MB)를 읽는다. 마지막 assistant 메시지의 `message.model`을 가져오고, `<synthetic>`은 건너뛴다.
- `/muse-spark|gpt-5\.6-terra/i`에 맞는 모델만 통과한다. 그 밖은 "앱에서 모델을 Muse로 바꾸거나, 터미널에서 ocx claude로 여세요"로 막는다: Claude 모델(`claude-opus-5-5`, `claude-sonnet-5` …), DeepSeek, transcript가 없거나 못 읽음, 거기 모델이 없음(fail-closed).
- 읽기 명령(`brief`, `flight`, `gh pr view` …)은 확인하지 않는다.
- 통과하면 guard는 PreToolUse `updatedInput`으로 답한다: 같은 명령 앞에 `ATC_CROSSCHECK_MODEL='<real model>'`을 붙인 것. atcctl은 그것을 mark의 `model`로 보낸다.
- 세션이 이름을 직접 넣을 수 없다.
  - 명령 앞의 변수는 이미 막혀 있다.
  - mark 명령의 `--model`은 막힌다.
  - mark 명령은 혼자 있어야 한다(파이프나 이어 붙이기 없음). 그래야 접두어가 atcctl에 걸린다.
- 실제 transcript에서 본 이름(2026-09-26 시험 세션에서 확인): `ocx claude`로는 `claude-ocx-opencode-go--muse-spark-1.3-contributor`(요청한 id의 `[1m]` 없이), ClaudeRipple(Desktop의 경로)로는 `muse-spark-1.3-contributor`, opus는 `claude-opus-5-5`. 세션의 첫 도구 호출 때는 transcript에 assistant 메시지가 아직 없다. mark 명령은 늘 한 바퀴의 뒤쪽에 온다.
- 서버는 이름을 op에 저장한다(`{…, model}`, 120자까지). 이름이 없는 mark는(이 필드가 생기기 전에 기록된 mark 모두 포함) `"unknown"`으로 읽힌다. 이 확인 전에 만든 mark는 기록된 이름을 그대로 가진다.
- `gateOf(...).crosscheck`는 전체 `{marked, matched, rate}`를 유지하고, 모델 계열을 키로 한 `byModel: {<family>: {marked, matched, rate}}`를 더한다(`server/crosscheck.ts`의 `modelFamily`가 경로 접두어, `[1m]` 같은 접미어, `-contributor`를 떼므로 Muse의 두 경로가 모두 `muse-spark-1.3`으로 센다). `examples`에는 mark의 모델이 들어간다. mark 자체는 전체 모델 이름을 가지고, 칩의 툴팁에 보인다. 모델 이름을 기록하기 전의 mark는 `unknown`으로 남고, ATFM의 켜는 조건은 이것을 절대 세지 않는다.

**화면.** DISPATCH·SCHEDULE 탭의 열린 카드에 점선 칩 `CROSSCHECK agree · <reason>`이 보인다.
- "CROSSCHECK에 동의" 버튼은 같은 결정을 한 번에 낸다: 그림자 → 판정, 승인 → 승인/거절.
- `disagree` mark에 동의하면 그 사유가 결정 사유가 된다.
- 승인 모드의 승인은 확인 창을 유지한다. FLIGHT PLAN을 보내거나 Linear에 쓰기 때문이다.
- 게이트 패널은 "CROSSCHECK 일치 n/m (xx%)"를 게이트 기준 밖의 참고 줄로 보이고, 모델마다 하위 줄을 둔다(짧은 이름, 예: `muse-spark-1.3-contributor`, 전체 id는 툴팁).
- 칩은 시각 옆에 짧은 모델 이름을 보이고, 칩과 RECENT 툴팁은 전체 id를 준다.

## 11. 넘어가는 기준

| 전환 | 기준(제안값) |
|---|---|
| S0 (OCC 세션, DISPATCH 합침, Linear 읽기 전용) | 바로 시작 가능 |
| S0 → S1 | SCHEDULE 기록, 탭, `atcctl schedule draft`가 있음 |
| S1 → S2 | 결정된 초안 20건 이상, 합의율 80% 이상(atc 게이트, `gateOf`), 나중에 발견된 중복 0건(atc가 세지 않음: 아직 만들지 않음). **vocado `CLAUDE.md`의 "Linear에는 리더만 쓴다"를 "OCC와 리더가 Linear에 쓴다. OCC는 계획 필드, 리더는 실행 필드를 쓴다"로 바꿈** |
| S2 → S3 | S2 2주 이상, 사람이 되돌린 작업이 거의 없음, 잘못된 payload로 생긴 linear-guard 차단 없음 |

## 12. 위험과 대응

| 위험 | 대응 |
|---|---|
| 티켓 스팸이 backlog를 채움 | 열린 초안 한도(5건. 하루 한도는 아직 만들지 않음), 중복 검색 필수, 먼저 그림자로 초안 품질을 잰다 |
| 보안 티켓의 범위가 틀림 | vocado 템플릿(허용 파일, 금지 변경, 불변 조건). CAUTION 작업은 절대 자동이 아님 |
| 끝나지 않은 이슈를 닫음 | `CLOSE`에는 확인한 근거(LOGBOOK의 머지된 PR)가 필요. release하지 않고, 이슈는 SUPERVISOR가 Linear에서 닫는다(5.5) |
| OCC가 일을 만들고 자기에게 DISPATCH함 | SUPERVISOR가 두 단계를 모두 승인. 충돌은 별도 세션인 ATC가 심판 |
| OCC와 CAPTAIN이 같은 필드에 씀 | 필드 주인(4장), linear-guard가 강제 |
| Linear API rate limit | 묶어서 조회, API 첨부 없음, 하루 쓰기 한도(아직 만들지 않음) |
| 오래된 운영 매뉴얼 | 해시가 바뀌면 `/tick`이 `CLAUDE.md`를 다시 읽음 |

## 13. 구현 순서

1. ✅ **S0**: `atc/dispatch/`로 `atc/occ/`를 만든다(합침). guard에 읽기 전용 `gh`, 읽기 전용 MCP guard, 바뀌면 매뉴얼 다시 읽기. 남은 일(2026-09-26 기준, 그 뒤 다시 확인하지 않음): President에게 인계 알리기
2. ✅ planner의 TAIL ASSIGNMENT `tail:TEAM_X`. 처음에는 `lane:TEAM_X`로 나갔다(VOC-196 이중 DISPATCH를 바로 고침). 라벨은 기존 Linear 조회에서 읽는다
3. ✅ **S1**: SCHEDULE 기록, API, `atcctl schedule`, SCHEDULE 탭, 그림자 판정. 첫 작업: `CLASSIFY`와 `PRIORITIZE`. 그다음 `NEW`(CHARTER DESK, 5.1)와 ✅ `CLOSE`(5.5, 2026-09-27)
4. ✅ `/tick`의 운항 추적: `atcctl following`(단계, 지연, 불일치, 반복 보고 없음)과 팀 보고용 읽기 전용 `gh`. ✅ TOWER의 CLEARED TO LAND 점검(9.1)
5. ◐ **S2**: `mode` 뒤에 구현(linear-guard, `schedule release`, APPLIED 감지). 켤 때 남은 일: vocado `CLAUDE.md` 규칙 변경(그때 SUPERVISOR에게 확인)
6. **S3**: 자동 작업. S2 데이터가 뒷받침하는 것만
7. ✅ **CROSSCHECK**: 다른 계열 모델의 예비 mark, 한 번 눌러 결정, 일치율은 게이트 밖에 둠. 남은 일: 일치율을 보고 `SEC`가 아닌 작업을 사람 없이 넘길지 정하기

## 결정 (2026-09-26, SUPERVISOR)

| 항목 | 결정 |
|---|---|
| 구조 | 관제 세션 둘: OCC(운항)와 ATC(교통) |
| DISPATCH | 별도 세션으로 두지 않고 **OCC에 합침** |
| Linear 쓰기 | OCC는 S2부터 Linear에 쓸 수 있다. vocado의 "Linear에는 리더만 쓴다" 규칙은 S2에서 **바꿀 수 있다** |
| 순서 | 설계 문서 먼저 |
| 보안 PR을 DeepSeek에 (2026-09-27, ATC-30) | Codex를 쓸 수 없을 때 DeepSeek V4.1 Flash 착륙 리뷰어가 보안 PR도 리뷰할 수 있다 — **`externalReview.security`가 `"deepseek"`일 때만**. 그러면 vocado 보안 diff와 Linear 이슈 본문이 DeepSeek로 나간다. `.env`·비밀·키 경로와 FLIGHT 없는 PR은 보내지 않고, Muse는 착륙에 쓰지 않는다(9.5) |
| main 병합만 한 head의 리뷰 (2026-09-27, ATC-31) | vocado의 `strict`(최신 main 필수)는 그대로 둔다. head까지 main 병합뿐이고 PR 자신의 변경(merge-base 대비 파일과 blob)이 같으면 이전 커밋의 리뷰를 잇는다. 지적은 지적으로 잇는다(9.6) |
| AUTOLAND (2026-09-28, ATC-34) | `autoland: off \| update \| merge`(기본 off, SUPERVISOR만) 뒤에 AUTOLAND를 만든다. 배포 뒤 `update`를 켠다. `merge`는 SUPERVISOR가 vocado `AGENTS.md`에 AUTOLAND 예외를 적을 때까지 끈다. force-push, GitHub auto-merge, 브랜치 보호·`strict` 변경 없음(9.7) |

남은 결정: S3 자동 목록의 정확한 범위(S2 데이터 뒤), 그리고 TOWER 세션 이름을 ATC로 바꿀지 그대로 둘지.
