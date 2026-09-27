# OCC 설계 (초안)

[English](occ.md) · **한국어**

atc는 항공처럼 관제 세션을 둘로 나눈다.

- **OCC**(운항통제센터, 항공사 쪽)는 **무엇을, 누가, 언제 날릴지** 정한다. 스케줄(Linear 티켓)을 관리하고, FLIGHT를 팀에 DISPATCH하고, 착륙할 때까지 따라간다.
- **ATC**(항공교통관제)는 이미 떠 있는 것들의 **간격을 지킨다**. 지금은 TOWER, 나중에는 흐름 관리(3단계)다.

실제 항공에서 운항관리사(flight dispatcher)는 ATC가 아니라 항공사 OCC에 속한다. 그래서 DISPATCH(2단계)를 OCC로 옮기고, 지금 "President" 세션이 손으로 하는 일을 OCC가 넘겨받는다.

> 상태:
>
> - **S0 구현**(2026-09-26): `atc/occ/` 세션(DISPATCH를 합침), 읽기 전용 `gh`, 읽기 전용 MCP guard, 매뉴얼 다시 읽기, planner의 TAIL ASSIGNMENT(`tail:TEAM_X`, [fleet.ko.md](fleet.ko.md) 참고).
> - **S1 구현**: `CLASSIFY`, `PRIORITIZE`, `NEW`, `CLOSE`의 SCHEDULE 초안을 그림자 운용한다(`server/schedule.ts`, `atcctl schedule brief|draft`, SCHEDULE 탭, OCC 규칙).
> - `NEW`는 CHARTER DESK다. CHARTER REQUEST로 AD HOC FLIGHT 초안을 만든다. 본문 섹션을 점검하고, 스냅숏(최근 45일 안에 바뀐 이슈)에서 제목이 비슷한 중복을 찾는다.
> - `CLOSE`(5.5, 2026-09-27 구현)는 PR이 머지된 FLIGHT를 닫자는 초안이다. release하지 않고, 이슈는 SUPERVISOR가 Linear에서 닫는다.
> - 열린 초안은 종류를 합쳐 최대 5건이다. 판정 없이 3일이 지나면 만료된다.
> - ATC의 CLEARED TO LAND 점검(9장)은 구현됐다. LANDING SEQUENCE는 이제 열린 GitHub PR에서 나온다.
> - 나머지 작업(`TAIL`, `LINK`, `SPLIT`, `COMMENT`)과 S3는 설계만 있다(아직 만들지 않음).
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
| `TAIL` | `tail:TEAM_X`를 더하거나 바꿈(TAIL ASSIGNMENT) | VOC-196 → `tail:TEAM_E`(President가 정한 대로) |
| `CLASSIFY` | FLIGHT TYPE, WAKE CATEGORY, 필요한 TYPE RATING을 정함([fleet.ko.md](fleet.ko.md) 4장) | VOC-195 → `type:MAINT`, `wake:M`, `rating:SEC` |
| `LINK` | 상위, `blocks`, `related` 관계 더하기 | VOC-196은 VOC-52에 막혀 있음(본문에만 적힘) |
| `SPLIT` | 발견한 것을 하위나 related 티켓으로 | PR #400 리뷰의 P3 항목 |
| `COMMENT` | 계획 댓글 남기기(실행 댓글이 아님) | "VOC-52가 끝날 때까지 미룸" |

구현: `NEW`(CHARTER DESK, 5.1), `CLOSE`(5.5), `PRIORITIZE`, `CLASSIFY`. 아직 만들지 않음: `TAIL`, `LINK`, `SPLIT`, `COMMENT`.

### 5.1 작업은 어디서 오나

- **SUPERVISOR의 지시(CHARTER DESK)**: OCC 세션에서 바로 하는 CHARTER REQUEST("X 티켓 만들어 줘")는 `NEW` 초안, 곧 AD HOC FLIGHT(정규 스케줄 밖에서 더한 FLIGHT)가 된다.
  - 승인되고 Linear Todo에 오르면(S2) 다른 FLIGHT처럼 FILED된다.
  - 팀에 바로 맡긴 작은 티켓 없는 일은 AD HOC이고, SCHEDULE 작업이 되지 않는다.
  - OCC는 스스로 `NEW`를 쓰지 않는다. 예외는 하나, 덮는 이슈가 없는 WAYPOINT 완료 기준이다(5.6). SUPERVISOR가 이미 적어 둔 기준을 옮기는 것이다.
  - 중복 검색(5.3)은 atc의 스냅숏을 본다. 스냅숏에는 최근 45일 안에 바뀐 이슈가 있다.
- **팀의 발견**: CAPTAIN이 "범위 밖에서 Y를 찾았다"고 보고 → `SPLIT`.
- **PR 리뷰**: 리뷰의 후속 항목 → `SPLIT`.
- **atc 신호**: 끝났는데 열려 있음(`CLOSE`), 우선순위 없음(`PRIORITIZE`), 본문에만 적힌 선행 작업(`LINK`), 방치된 ENROUTE(DISPATCH의 `RELEASE` 경우).
- **4단계 네트워크 계획**: 목표를 티켓으로 나눈 것. 초안으로만.
- **WAYPOINT gap**(5.6): 지금 구간이나 다음 WAYPOINT의 완료 기준 가운데 덮는 이슈가 없는 것 → 마일스톤을 단 `NEW`.

### 5.2 티켓 본문

`NEW`와 `SPLIT`은 vocado 형식을 쓴다. `CLAUDE.md`의 네 칸(목표, 허용 범위, 금지 변경, 완료 기준), 또는 DB·마이그레이션·보안·권리 작업이면 `Codex Engineering Task` 템플릿이다. 이런 티켓에는 늘 CAUTION이 붙고, CAUTION 작업은 절대 자동이 아니다(7장).

### 5.3 중복과 한도

- `NEW`나 `SPLIT` 전에 OCC는 열린 이슈와 최근 닫힌 이슈를 찾아보고, 찾은 결과를 작업에 남긴다("중복 없음: X, Y 검색").
- 열린 초안은 종류를 합쳐 최대 5건이다(`server/schedule.ts`의 `SCHEDULE_OPEN_LIMIT`). 넘으면 atc가 새 초안을 거부하고(409), OCC는 초안을 멈추고 보고한다. 적용된 `NEW` / `SPLIT`의 하루 한도(하루 10건, 설정 파일)는 아직 만들지 않았다.
- `CLOSE`에는 OCC가 직접 확인한 근거가 필요하다: 머지된 PR, 설정 읽기, 댓글. "끝난 것 같다"로는 안 된다.

### 5.4 CLASSIFY 정확도

첫 SCHEDULE 판정 7건(2026-09-26)에서 SUPERVISOR가 거절한 초안 3건은 모두 CLASSIFY를 잘못 읽은 것이었다.
- **S-0001 (VOC-195), S-0004 (VOC-196):** [fleet.ko.md](fleet.ko.md) 4.1은 `MAINT`인데 FLIGHT TYPE을 `BUILD`로 했다. 하나는 lock race 수정, 하나는 CI·정적 게이트였고, 둘 다 제품 동작을 바꾸지 않는다.
- **S-0006 (VOC-181):** 4.2는 `L`인데 WAKE를 `M`으로 했다. 파일 하나에 규칙 둘, 새 테스트 없음.

4.1을 인용한 CROSSCHECK는 이것들을 맞혔다. 이제 OCC도 같은 방식으로 한다(`occ/CLAUDE.md` "CLASSIFY 전에").

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

- **데이터.** `schedule brief`에 `waypointGaps`가 있다(`server/waypoint-gaps.ts`, 순수 함수 `waypointGapsOf`). 끝나지 않은 ROUTE마다 지금 구간 WAYPOINT와 그다음 WAYPOINT가 있고, 각각 `criteria`("Exit criteria" 아래 번호 목록), 목록이 없으면 `description`, 그 마일스톤의 `issues`(key·제목·상태, 취소·중복 제외), `truncated`가 붙는다. WAYPOINT가 없거나 모두 지난 ROUTE는 뺀다. `null`이면 마일스톤을 못 읽은 것이다.
- **판단은 OCC가 한다.** 서버는 기준과 이슈를 짝짓지 않는다. OCC는 바퀴마다 gap을 읽고 열린·끝난 이슈 가운데 어느 것도 덮지 않는 기준을 가린다. 사람이 정할 기준("SUPERVISOR decides", 사용자 모집·인터뷰)과 확인할 끝 조건이 없는 설명은 건너뛰고, **바퀴마다 2건까지** 지금 구간 WAYPOINT부터 올린다(`occ/CLAUDE.md` "WAYPOINT gap").
- **초안.** `schedule draft NEW --gap --project <ROUTE> --milestone <WAYPOINT> …`. 본문은 네 칸이고 `## 목표`에 기준을 인용한다. `milestone`은 그 프로젝트의 마일스톤(이름이나 id)인지 검사하고 `changesOf`에 보인다("WAYPOINT Beta Ready"). `--gap`은 마일스톤이 있어야 하고, `similarTickets`가 비슷한 FLIGHT를 찾으면 atc가 받지 않는다. OCC가 놓쳐도 "중복이면 쓰지 않는다"가 지켜진다. gap 초안도 열린 초안 5건 한도에 든다.
- **S2.** 발부된 `save_issue` 호출에 `milestone: <마일스톤 id>`가 들어가 새 이슈가 그 WAYPOINT에 붙는다. linear-guard(`occ/mcp-guard.mjs`, 바꾸지 않음)는 그 입력과 똑같을 때만 통과시킨다. 마일스톤을 빼거나 이름·다른 id를 넣으면 막히는 것을 `occ/mcp-guard.test.mjs`가 확인한다.
- CROSSCHECK는 다른 SCHEDULE 초안처럼 이 초안에도 mark를 단다.

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

다음 Linear 조회에 변경이 보이면 atc가 release된 작업을 APPLIED로 표시한다. `NEW`는 초안 뒤에 만들어진 같은 제목(정규화)의 이슈, `CLASSIFY`와 `PRIORITIZE`는 초안대로 된 라벨이나 우선순위, `CLOSE`는 Done이나 Canceled가 된 이슈다. release 전에 이미 변경이 보이면 APPLIED가 아니라 SUPERSEDED다.

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
| President: 일 맡기기 | DISPATCH 제안. 2b 전까지는 사람이 직접 한 배정을 `tail:TEAM_X` 라벨로 기록해서 planner가 볼 수 있게 한다. 지금은 손으로 붙인다. SCHEDULE `TAIL` 작업은 아직 만들지 않았다 |
| President: 팀 보고 확인 | **운항 추적**(flight following). atc가 배정된 FLIGHT를 모두 따라간다(`server/following.ts`, `GET /api/following`): 수락·출발·RECALL 중인 DISPATCH ASSIGN, 그리고 `tail:` 라벨이 붙은 In Progress FLIGHT. READBACK → DEPARTED → PR 열림 → CLEARED → ARRIVED 단계를 따라가고(STAND 없는 FLIGHT는 READBACK → DEPARTED → ARRIVED, 8.1), 지연(WAKE 기대치의 1.5배가 지나도 다음 단계가 없음)과 Linear·PR 불일치를 표시한다. OCC는 바퀴마다 `atcctl following`을 돌려 새 문제만 보고하고 `following ack`로 기록해서, 같은 것을 두 번 보고하지 않는다. 팀에 메시지를 보내지 않는다. 팀 보고나 SUPERVISOR 요청이 오면 OCC는 여전히 읽기 전용 `gh`(`gh pr view`, `gh pr checks`, `gh pr diff`)로 PR head, CI, 리뷰를 확인한다. 기계적인 착륙 점검은 ATC의 CLEARED TO LAND(9장)다 |
| President: Linear 정리 | SCHEDULE 작업 |
| President: 규칙 파일 관리 | TEAM이 PR로 구현하는 `NEW` 티켓 |
| President: PR 리뷰와 범위 판단 | SUPERVISOR에게 남는다. OCC는 요약할 수 있지만 결정하지 않는다 |

OCC의 guard는 TOWER의 Bash guard에 읽기 전용 `gh` 하위 명령을 더한 것이다(`guard.mjs --gh-read`). Edit과 Write는 계속 거부된다. `occ/mcp-guard.mjs`는 읽기 MCP 도구(이름이 get, list, search, read, query, fetch로 시작)만 통과시킨다. 그래서 S0에서는 커넥터가 로드돼 있어도 OCC가 Linear나 GitHub에 쓸 수 없다. S2에서는 linear-guard가 승인된 작업의 release된 호출에 한해 Linear 쓰기를 연다(6장).

세션은 매뉴얼을 다시 읽는다. `/tick`은 `atcctl manual check`로 시작한다. `CLAUDE.md`와 `/tick`의 해시를 마지막 `atcctl manual ack`(`~/.local/state/atc/manuals/`에 저장)와 비교한다. 바뀌었으면 세션은 다른 일보다 먼저 다시 읽는다. TOWER의 `/tick`도 같다. 1장의 옛 매뉴얼 사건은 이것으로 고쳐진다.

**President는 물러난다.** 세 가지가 모두 되면: OCC가 S1을 일주일 운용했고, 운항 추적이 모든 팀 보고를 다루고, `TAIL` 작업을 쓰고 있다(아직 만들지 않음). 그때까지 President는 계속 일을 맡기고, 배정마다 `tail:` 라벨을 손으로 붙인다.

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

### 9.2 Codex를 쓸 수 없을 때 Muse 리뷰 (2026-09-27, ATC-7)

2026-09-27에 vocado PR 17개(#366–#399)가 CI는 초록인데 26–49시간째 APPROACH에 서 있었다. Codex가 "You have reached your Codex usage limits"로 답했고 다른 리뷰어가 없었다. SUPERVISOR는 CROSSCHECK의 Muse 리뷰가 Codex를 대신해도 된다고 정했다.

- **CODEX UNAVAILABLE**(`codexUnavailableOf`, `server/landing.ts`): 현재 head에 Codex 리뷰(Codex 지적, head 뒤 Codex 👍)도 사람 통과 리뷰도 없고, head 뒤에 Codex 봇이 한도 댓글을 남겼거나(`why: "limit"`), head 커밋과 PR을 연 때 중 늦은 쪽부터 `ATC_CODEX_SILENT_HOURS`(기본 6)시간 동안 Codex 신호가 없는(`why: "silent"`) PR. 한도가 아닌 Codex 댓글이 오면 기다림은 다시 센다. Draft는 Codex 신호를 읽지 않으므로 해당하지 않는다. PR에는 `codexUnavailable`과 `muse`(`excluded`, `waiting`, `pass`, `findings`)가 붙고, TOWER 브리핑의 `landingQueue`에는 `codex`, `muse`, `review`가 있다.
- **Muse에 보내지 않는 PR**(`museExclusionOf`): vocado 규칙은 요청 자료가 학습에 쓰이므로 기밀 작업에 Muse를 쓰지 않는다. FLIGHT에 `rating:SEC`, `Risk: Security`·`Risk/Security`·`Security` 라벨, PR이나 FLIGHT에 `Risk: Rights`·`Rights`, `Risk: Contract`·`Contract` 라벨이 있거나, 바뀐 경로가 `.env*`, `secrets/`, `keys/`, `certs/`, `*.pem`·`*.key`, `id_rsa…`, 이름에 secret·credential·private key·service account·API key가 든 파일이면 뺀다. atc는 head에 Codex 리뷰가 없는 PR마다 바뀐 경로를 읽어 두고(`gh api …/pulls/N/files`, head별 캐시), 자료를 주기 직전에 실제 diff로 다시 본다. 이런 PR은 Codex나 SUPERVISOR 리뷰를 기다리고, 막힘 글이 그렇게 말한다: "Codex 한도 — Muse 리뷰 제외(rating:SEC) — Codex나 SUPERVISOR 리뷰 필요".
- **리뷰 자료**: `GET /api/landing/review/:repo/:pr`(`:repo`는 저장소 이름이나 `owner/name`)가 PR 제목·본문(8,000자), FLIGHT의 완료 기준과 금지 사항(Linear 본문에서 완료 기준/Acceptance/Exit criteria/Done when, 금지/Forbidden/Do not/Out of scope 머리글 아래, 본문은 6,000자까지), head SHA, 바뀐 파일, diff(80,000자, 넘으면 줄 경계에서 자르고 `diffTruncated`)를 준다. CROSSCHECK는 `gh pr diff`를 못 쓰므로 atc가 읽기 전용 `gh pr view`·`gh pr diff`로 읽는다. 제외된 PR은 403, Draft·Codex를 쓸 수 있는 PR·head가 바뀐 PR은 409.
- **리뷰 기록**: `POST /api/landing/review/:repo/:pr {head, verdict, text, model}`이 `landing-reviews.jsonl`에 추가한다(`at, repo, number, head, verdict, text, by, model, family, p0, p1, p2`). head는 지금 head여야 한다(7자 이상 앞부분도 된다). `pass`에는 P2만 적을 수 있고 P0·P1은 안 되며, `findings`에는 P0·P1·P2가 하나 이상 있어야 한다. model은 필수다: CROSSCHECK guard가 세션 기록에서 실제 모델을 읽어 붙이고(mark와 같다, 2026-09-26), 계열은 `modelFamily`로 남긴다. `atcctl landing review <repo>#<pr> [--head <sha> --verdict pass|findings -- <글>]`이 두 호출을 감싸고, `crosscheck brief`는 `GET /api/landing/reviews`의 `landing.pending`·`landing.excluded`를 보여 준다.
- **착륙 규칙**(`reviewBlocks`): 제외되지 않은 CODEX UNAVAILABLE PR에서, 현재 head의 P0·P1 없는 Muse `pass`는 head 리뷰로 쳐서 CLEARED TO LAND가 될 수 있다. 스트립에는 "REVIEW: MUSE (Codex 한도)"(또는 "Codex 무응답")로 보인다. Muse `findings`는 등급과 리뷰 글이 든 `review-findings` 막힘이 되어("Muse 지적(Codex 한도, head abc1234, P0 0 · P1 1 · P2 0): …") TOWER가 Codex 지적처럼 CAPTAIN에게 전한다. 새 head는 새 리뷰가 필요하다. Codex가 돌아와 head를 리뷰하면(👍나 지적) Codex가 이기고 Muse 리뷰는 무시된다. `changes-requested`는 그대로 막는다.
- **guard**: `controller/guard.mjs --crosscheck`가 기존 명령에 더해 `landing review`를 허용한다. 기록(`--` 앞에 `--verdict`)은 mark와 같은 실제 모델 확인과 바꿔 쓰기를 거친다. `crosscheck/read-guard.mjs`는 그대로다. guard를 바꾸므로 이 PR은 `user` 등급이다.

## 10. atc에 더할 것

| 곳 | 내용 |
|---|---|
| `server/schedule.ts` (새 파일) | SCHEDULE 기록(`~/.local/state/atc/schedule.jsonl`, 추가만 함), 상태 전이, Linear 조회로 APPLIED 감지, 열린 초안 한도(하루 한도는 아직 만들지 않음) |
| `server/sources/linear.ts` | 라벨(`tail:`, `type:`, `wake:`, `rating:`), 최근 닫힌 이슈(중복 검색용) 읽기. NEW의 APPLIED는 `S-xxxx` footer가 아니라 제목으로 감지한다(6장) |
| `server/dispatch.ts` | `tail:TEAM_X`와 [fleet.ko.md](fleet.ko.md) 5장의 분류 규칙 따르기 |
| API | `GET /api/schedule/brief`, `GET /api/schedule/ops/:id`, `POST /api/schedule/ops`(초안), `POST /api/schedule/ops/:id/{verdict,approve,reject,release}`, `POST /api/schedule/mode` |
| `atc/occ/` | `atc/dispatch/`에서 옮김: `CLAUDE.md`(운영 매뉴얼), `/tick`, send-guard, **linear-guard**, 읽기 전용 `gh`가 있는 Bash guard |
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

**LANDING 리뷰**(2026-09-27, ATC-7. 9.2): Codex를 쓸 수 없으면 CROSSCHECK는 atc가 주는 PR diff도 리뷰하고(`atcctl landing review`) P0·P1·P2로 `pass`·`findings`를 남긴다. 현재 head의 pass는 착륙 근거가 된다. 기밀 PR(rating:SEC, Risk, 비밀 경로)은 보내지 않는다.

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

이름은 `CROSSCHECK`, `/loop 10m /tick`으로 돌린다.

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

남은 결정: S3 자동 목록의 정확한 범위(S2 데이터 뒤), 그리고 TOWER 세션 이름을 ATC로 바꿀지 그대로 둘지.
