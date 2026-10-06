# Skill 시범 점검: 시범 항목은 필요한 FLIGHT에서 불렸나?

[English](skill-pilot-readout.md) · **한국어**

> CHECK FLIGHT [ATC-358](https://linear.app/vocado/issue/ATC-358). [ATC-282](https://linear.app/vocado/issue/ATC-282) C절이 계획한 점검이다. 읽기만 했다: Linear, GitHub 이슈, skill, 매뉴얼, guard, 설정, `~/.local/state/atc/`에 쓰지 않았고 세션에 메시지를 보내지 않았다. 2026-10-02 04:50 UTC쯤 읽었다.

## 1. 요약

| 항목 | 기대 | 호출 | 놓침 | 자료 없음 | 판정 |
|---|---|---|---|---|---|
| `diagnosing-bugs` | 1 | 0 | 1 | 0 | **유지, 경로 바꿈** (표본 하나: 가치는 판정하지 않는다) |
| `ui-review` | 23 | 9 | 13 | 1 | **유지, 경로 바꿈** |
| `codebase-analyzer` | 없음 | 한 세션이 FLIGHT 3개에서 3번 | 해당 없음 | 해당 없음 | **유지**, 나중에 다시 본다 |
| `codebase-locator` | 없음 | 0 | 해당 없음 | 해당 없음 | **뺀다** |

- `atc-task`의 routing line이 이 skill들을 여는 것이 아니다. 기대 FLIGHT를 모는 AIRCRAFT 세션 19개 가운데 `atc-task`를 연 세션은 6개이고, 열지 않은 13개 중 5개도 `ui-review`를 불렀다. skill을 한 번 부른 세션은 이어지는 FLIGHT에서 다시 부르지 않는다: `ui-review`는 세션의 첫 화면 FLIGHT에서 불렸고 뒤의 FLIGHT에서는 건너뛰었다(4절).
- `GET /api/skills/usage`의 수는 세는 것에 대해서는 맞지만, 읽기 쪽 문제 셋이 FLIGHT별 그림을 가린다(7절).
- FLIGHT당 FUEL은 기준선 중앙값보다 약 20% 많지만 표본이 작고 구성이 다르다. 호출한 FLIGHT와 놓친 FLIGHT도 가르지 못한다(6절).

**2026-10-06 확인(읽기만, `GET /api/skills/usage?days=7`).** 2026-10-05까지의 하루 줄도 같은 모양이다: `diagnosing-bugs`와 `codebase-locator`는 어느 날도 불리지 않았고, `codebase-analyzer`는 2026-10-02와 2026-10-03에 각 2번, `ui-review`는 계속 불렸다(2026-10-02 11번, 2026-10-03 15번, 2026-10-05 1번). 판정이 바뀌지 않으므로 위의 FLIGHT별 수(2026-10-02 기준)는 다시 세지 않았다.

## 2. 창과 방법

- **창.** 시범(`diagnosing-bugs`, `codebase-*`)은 2026-10-01 06:04Z(#345), `ui-review`는 06:20Z(#350)에 `main`에 들어갔다. 창은 2026-10-02 04:50Z까지다. 이 안에서 머지된 atc PR은 49개이고, STAND가 06:04Z 이후에 시작된 FLIGHT가 41개, 그 가운데 `web/src`를 바꾸고 06:20Z 이후에 시작된 것이 23개다.
- **기대 FLIGHT.** routing line이 `main`에 들어간 뒤에 STAND를 claim한 FLIGHT(STAND는 `origin/main`을 받으므로 더 일찍 만든 STAND는 옛 `atc-task`를 가진다). 창 안에서 머지됐지만 뺀 PR이 8개다: STAND가 더 일찍 시작된 FLIGHT 6개(예: ATC-270, ATC-283, ATC-293)와 ATC key가 없는 PR 2개. ATC-268(06:12Z에 claim한 화면 FLIGHT)은 시범에는 세지만 `ui-review`(06:20Z)에는 세지 않는다.
- **기대.** `diagnosing-bugs`: Linear 이슈에 `Bug` 라벨(제목이나 본문만으로는 세지 않았다). `ui-review`: PR diff가 `web/src`를 건드림. `atc-task`: 모든 FLIGHT. `codebase-*`는 기대가 없다.
- **호출.** 그 FLIGHT를 몬 AIRCRAFT의 transcript에서 FLIGHT 시간(claim 5분 전부터 머지 5분 뒤까지) 안에 있는 `Skill` 호출(sub-agent는 `Agent` 호출). 세션과 FLIGHT는 `departures.jsonl`의 AIRCRAFT 이름과 시각으로 맞췄다. 한 세션이 FLIGHT 여럿을 이어서 모는 일이 많아서, 호출은 그것이 속한 시간 창의 FLIGHT에 붙인다.
- **읽은 자료.** 이름·시각·`subagent_type`만, atc 폴더와 STAND의 transcript에서 줄 단위로 흘려 읽었다. 메시지 본문은 읽지 않았다. 하루 줄은 `GET /api/skills/usage?days=3`, FUEL은 `GET /api/logbook?days=14`, PR은 `gh pr list --state merged`, 라벨은 Linear 읽기 목록.
- **한계.** 끝난 STAND의 transcript는 지워지고 있어서, 2026-10-01 하루 줄에는 디스크의 어떤 transcript에서도 더 보이지 않는 호출이 들어 있다(7절 3번). 기대 FLIGHT 하나는 세션 기록이 아예 없다. sub-agent(sidechain)의 호출은 reader가 세지 않는다.
- **다른 AIRPORT: 이름 있는 세션 3개**가 하루 줄에 있다(skill 호출 1, agent 호출 12, 시범 네 항목은 없음). 그 밖의 것은 쓰지 않았다.

## 3. 하루 호출 수

| | 2026-10-01 (UTC, 하루) | 2026-10-02 (04:42Z까지) |
|---|---|---|
| `atc-task` | 12 | 1 |
| `ui-review` | 13, 워크트리 접두어 이름 2 | 0 |
| `diagnosing-bugs` | 0 | 0 |
| `codebase-analyzer`(agent) | 3 | 0 |
| `codebase-locator`(agent) | 0 | 0 |
| 내장 `Explore` / `general-purpose`(agent) | 23 / 111 | 0 / 0 |
| `tick` | 16 | 3 |

2026-10-01 줄에는 시범이 `main`에 들어가기 전 6시간도 들어 있어서 창보다 많게 센다. 내장 agent가 시범 agent보다 훨씬 많이 불리고, 세션이 손을 뻗는 것은 `general-purpose`다(111. MCC의 `inspector`는 따로 91).

## 4. 항목별

### 4.1 `ui-review` (기대 23)

- **호출(9):** ATC-263, ATC-287, ATC-300, ATC-313, ATC-315, ATC-316, ATC-325, ATC-327, ATC-328. ATC-263과 ATC-325는 워크트리 접두어 이름으로 불렸다(7절 1번).
- **놓침(13), 세션 transcript 있음:** ATC-271, ATC-284, ATC-301, ATC-305, ATC-308, ATC-310, ATC-312, ATC-314, ATC-317, ATC-330, ATC-334, ATC-346, ATC-73.
- **세션 기록 없음(1):** ATC-348.
- **ATC-305:** `web/src`의 유일한 변경은 DOCS 탭 내비게이션 항목 하나다. 경계 사례이고 빼면 9/22가 된다.
- **질문 2(세션이 `atc-task`를 열었나, 그 판본에 줄이 있었나).** 놓친 13개 가운데 6개는 세션이 `atc-task`를 열었다(ATC-317·ATC-330·ATC-334는 첫 FLIGHT에서 한 번 연 같은 세션, ATC-271은 `atc-task`가 routing line보다 앞선 세션, ATC-301, ATC-314). 나머지 7개는 `atc-task`를 아예 열지 않았다. 06:20Z 뒤에 `atc-task`를 연 경우(ATC-301, ATC-314, ATC-317, ATC-330, ATC-334) 파일에 화면 FLIGHT 줄이 있었으니, 줄은 세션 앞에 있었고 따르지 않은 것이다.
- **패턴.** 세션마다 시작 뒤 첫 화면 FLIGHT는 `ui-review`를 받았고 뒤의 것은 받지 않았다: 한 세션은 ATC-263과 ATC-325에서 불렀지만 그 사이의 ATC-308과 ATC-312에서는 부르지 않았다. 다른 세션은 ATC-287에서 불렀고 ATC-284와 ATC-310에서는 아니다. 또 다른 세션은 ATC-316에서 불렀고 ATC-317, ATC-330, ATC-334에서는 아니다. FLIGHT마다의 brief는 메시지로 오고 routing line은 한 번 읽는 파일에 있다.
- **ATC-281이 예측한 것.** 세션이 읽는 글에 이름이 있는 skill은 16번 중 16번 열렸고, 긴 목록에서 기억해야 하는 것은 16번 중 4번이었다([research/skill-rulebook.md](skill-rulebook.md) 4.2). 여기서는 자료가 있는 FLIGHT 22개 중 9개: 4/16보다 높고 16/16보다 훨씬 낮다.
- **판정: 유지, 경로 바꿈.** 알려 주면 불리고, 그때까지는 비용이 없다. 알림을 `atc-task`에서 FLIGHT별 글로 옮긴다: 이슈에 `rating:UI` 라벨이 있거나 diff가 `web/src`를 건드릴 FLIGHT면 brief와 FLIGHT PLAN이 `ui-review`를 이름으로 적는다. 그리고 `atc-task`에는 다시 시작하지 않고 다음 FLIGHT를 맡는 세션은 3절 줄을 그 FLIGHT에 대해 다시 읽는다는 문장 하나를 더한다(작업 지시서 W2에 문구를 적었다).

### 4.2 `diagnosing-bugs` (기대 1)

- **기대:** ATC-330(`Bug` 라벨: AUTOLAND GROUND STOP이 걸리지 않음). 창 안에 `Bug`가 붙은 다른 FLIGHT는 없다.
- **호출 0, 놓침: ATC-330.** 세션은 70분 전 세션의 첫 FLIGHT에서 `atc-task`를 열었고(routing line이 `main`에 들어간 뒤), ATC-330을 세 번째 FLIGHT로 몰면서 `diagnosing-bugs`를 부르지 않았다. `ui-review`와 같은 패턴이다.
- **판정: 유지, 경로 바꿈.** 기대 FLIGHT 하나는 표본이 아니라서 skill에 대한 찬반을 말하지 않는다. #345의 scratch 시험(버그 FLIGHT에서 `atc-task` 3절을 따르라고 하면 skill이 열린다)은 시키면 작동함을 보였다. `ui-review`처럼 경로를 바꾼다: 이슈에 `Bug`가 있으면 brief가 이름을 적는다. `Bug` FLIGHT가 10개 돈 뒤에 다시 본다(작업 지시서 W5).
- 라벨 없이 제목으로만 버그인 FLIGHT(예: ATC-301, ATC-312, ATC-314)는 세지 않았고, 그것들도 부르지 않았다.

### 4.3 `codebase-analyzer` (기대 없음)

- **호출:** 3번, 모두 한 세션에서, ATC-332(SURVEY), ATC-333(설계 초안), ATC-334(BUILD)에서. 기대 FLIGHT 41개 중 3개, 세션 19개 중 1개.
- **컨텍스트 절약은 찬반 모두 근거가 없다:** 시범 이전 기준선 세션이 디스크에서 사라졌고(기준선 FLIGHT 10개 중 하나만 transcript 폴더가 남았다), PR 시점의 메인 컨텍스트 크기를 비교할 수 없다.
- **판정: 유지.** 여러 파일을 넓게 읽어야 하는 FLIGHT에서 쓰인다. 다음 점검에서 다시 보고, 여전히 한 세션의 버릇이면 개인 도구로 보고 routing을 멈춘다.

### 4.4 `codebase-locator` (기대 없음)

- **호출 0:** 2026-10-01 하루 줄과 2026-10-02 모두. ATC-282의 scratch 시험에서는 단순 검색 두 번 뒤에 한 번 불렸다.
- **겹침:** 내장 `Explore` agent(2026-10-01에 23번)가 같은 일(넓은 검색으로 경로 얻기)을 하고 모든 세션에 이미 있다. `codebase-locator`는 아무도 하지 않는 호출을 위해 vendored 파일, 제3자 고지, routing line을 더한다.
- **판정: 뺀다.** `.claude/agents/codebase-locator.md`와 `THIRD_PARTY_NOTICES.md`의 항목을 지우고, `atc-task`의 줄은 `codebase-analyzer`와 내장 `Explore`만 적는다(작업 지시서 W4). vendored 파일은 git 기록에 남아 나중에 되돌릴 수 있다.

## 5. `atc-task` (router)

- 기대 FLIGHT 41개는 디스크에 있는 세션 19개에서 돌았고, `atc-task`를 연 세션은 6개다. 세션은 FLIGHT를 1~6개씩 몰았으니 "FLIGHT마다 부른다"는 기대는 너무 엄격하다: skill을 이미 가진 세션은 다시 부를 필요가 없고, 컨텍스트에 있는 skill은 놓침이 아니다.
- 열지 않은 13개 세션에 `ui-review`를 부른 5개가 있어서, skill은 routing line 없이도 찾아진다(목록과 `description`이 알려 주거나 brief가 알려 줬다).

## 6. FUEL과 컨텍스트, 기준선과 비교

FUEL은 logbook의 FLIGHT당 captain+crew 토큰을 비교용으로 가중한 값이다(input 1, cache write 5m 1.25, cache write 1h 2, cache read 0.1, output 5, 백만 단위. 청구액이 아니라 대용 값이다). Sonnet FLIGHT만 쓰고 Opus FLIGHT 하나는 뺐다.

| 묶음 | n | 중앙값 | 평균 |
|---|---|---|---|
| 기준선(#345의 10개 FLIGHT) | 10 | 2.16 | 1.93 |
| 창의 BUILD FLIGHT | 37 | 2.57 | 2.77 |
| 창의 BUILD, `rating:UI` | 18 | 2.55 | 2.78 |
| 창의 BUILD, UI 아님 | 19 | 2.57 | 2.76 |
| `ui-review`를 부른 기대 화면 FLIGHT | 9 | 3.08 | |
| 부르지 않은 기대 화면 FLIGHT | 13 | 2.83 | |

- 창은 기준선 중앙값보다 약 19% 높다. 기준선은 UI 6개와 UI 아닌 것 4개(중앙값 2.38과 1.11)라 구성이 다르고, 창에는 의미 있는 UI 구분이 없다.
- 호출과 놓침의 차이는 9%(3.08 대 2.83)이고, 9개와 13개 FLIGHT에서 크기가 다른 FLIGHT 두 개가 움직일 수 있는 범위 안이다. **표본이 작다:** n이 9와 13이고, 한 세션의 FLIGHT는 cache를 나누며, 크기는 0.2에서 7.1까지다. 어느 항목이 토큰을 아끼는지 쓰는지는 결론 내지 않는다.
- **PR 시점의 컨텍스트 크기는 재지 못했다:** 기준선 세션의 transcript가 없고 창의 세션은 대부분 FLIGHT 여럿을 몰아서, 세션의 마지막 `usage`가 FLIGHT 하나의 것이 아니다.

## 7. Reader 문제 (`server/skill-calls.ts`, `server/skill-calls-run.ts`)

| # | 문제 | 근거 | 고칠 방향 |
|---|---|---|---|
| 1 | 디렉터리 범위 이름(`.claude/worktrees/<stand>:ui-review`)으로 부른 skill이 제 키로 센다. | 2026-10-01에 2번, 두 키로. `ui-review`에는 안 잡힌다. Claude Code가 디렉터리 범위 skill을 경로 접두어로 보여 주므로 세션이 그렇게 쓸 수 있다. | `usageOf`에서 `baseName`(`qrh`용으로 이미 있는 함수)으로 세고 원래 철자는 `names` 목록에 둔다. 시험: 두 키가 `ui-review`로 합쳐진다. |
| 2 | `unknown` 칸: 2026-10-01에 skill 호출 12. | `usageOf`는 세션 이름을 `agent-name` 줄에서, 없으면 관제 폴더 역할에서, 없으면 `unknown`으로 한다. 이름 없는 세션으로는 `claude -p` 실행(A/B와 scratch 시험)과 이름 없는 사용자 세션이 의심된다. 그 transcript 폴더가 지금 비어 있어서 12개를 나눌 수 없다. | 세션마다 폴더 종류(`stand`, `repo`, `scratch`, `control`)를 적고 `unknown`을 `unnamed`와 `scratch`로 나눈다. 하루 수에서 scratch 폴더(`…-tmp-scratch…`, job `tmp`)는 뺀다. |
| 3 | 남는 기록은 하루 합계뿐이고, FLIGHT별 자료는 지워지는 transcript에 있다. | 2026-10-01 줄에는 일반 `ui-review` 호출이 13인데 디스크의 transcript에는 7개가 보인다. 6개는 사라졌다. 시범 이전 기준선 STAND의 폴더도 사라졌다. | 하루 줄에 `calls` 목록을 더한다: 짧은 세션 id, 폴더 종류, STAND 이름(폴더에서), 이름, 시각. 본문은 없다. 다음 CHECK는 transcript 없이 가능하다. |
| 4 | `tick`은 루프를 시작할 때마다 한 번이지 한 바퀴마다가 아니다. | 2026-10-01의 16은 TOWER 3 + OCC 3 + CROSSCHECK 2 + MCC 6 + REVIEW 2와 정확히 같고, TOWER의 3분 루프는 하루에 약 480번 돈다. `/loop … /tick`은 (다시) 시작할 때 `Skill` 호출로 보이고, 이후 바퀴는 이미 불러온 skill을 쓴다. | 문서에 적는다(8절). `tick`을 tick 횟수로 읽지 않는다. |
| 5 | sidechain 호출은 일부러 건너뛰어서(`isSidechain`) sub-agent가 연 skill은 세지 않는다. 입력한 `/ui-review`는 사용자 메시지이지 `Skill` 호출이 아니다. | `scanLine` | `docs/skills.md` 6절에 적는다. 코드 변경 없음. |
| 6 | 수는 날과 세션 단위이고 FLIGHT는 키가 아니다. | 엔드포인트 | 3번의 `calls` 목록과 `?flight=` 보기. |

## 8. `docs/skills.md` 6절 정정

"확인하지 못함" 줄이 가려졌고 이 PR에서 고쳤다(한국어 안내도): `/loop … /tick`은 `tick`이라는 이름의 `Skill` 호출로 보이며, 루프를 (다시) 시작할 때마다 한 번이다. `skills["tick"]`을 tick 횟수로 읽으면 틀린다.

## 9. 후속 작업 지시서 (올릴 것. 여기서는 올리지 않았다)

| ID | 제목 | 범위 | 예상 등급 |
|---|---|---|---|
| W1 | Reader: `ui-review`와 `diagnosing-bugs`를 기본 이름으로 세고, `unknown`을 나누고, 호출별 목록을 더한다 | `server/skill-calls.ts`, `server/skill-calls-run.ts`와 시험(7절 1·2·3·6번). 하루 줄에 새 필드 `calls` 하나, 옛 줄도 읽는다. `GET /api/skills/usage`의 기존 필드는 바꾸지 않는다 | `auto`(읽기만 하는 서버 코드) |
| W2 | FLIGHT별 글에 시범 skill을 이름으로 적는다 | brief 생성기와 FLIGHT PLAN 문구가 한 줄을 더한다: 이슈에 `rating:UI`가 있거나 계획이 `web/src`를 적으면 `Before the PR, call Skill ui-review (mode diff)`, `Bug`가 있으면 `Before changing code, call Skill diagnosing-bugs`. `atc-task` 3절에 문장 하나: 다음 FLIGHT를 맡는 세션은 이 줄을 다시 읽는다. 계획을 보내는 때와 기록 형식은 바꾸지 않는다 | `atc-task` 수정은 `user`(루트 `.claude/`), 서버 문구는 `flagged`. PR 둘 |
| W3 | `docs/skills.md` 6절: `tick`은 루프 시작당 한 번, sidechain과 slash command 설명 | 문서. 한국어 안내도 | `auto`(`tick` 줄은 이 PR에서 끝냄) |
| W4 | `codebase-locator`를 뺀다 | agent 파일과 `THIRD_PARTY_NOTICES.md` 항목을 지우고, `atc-task` 줄이 `codebase-analyzer`와 내장 `Explore`를 적게 하고, `docs/skills.md` 2.1과 안내를 고친다 | `user`(루트 `.claude/`) |
| W5 | CHECK: W1·W2 뒤의 시범 점검 | `Bug` FLIGHT 10개와 화면 FLIGHT 10개 이상 뒤에 연다. transcript 대신 `calls` 목록을 읽고, 호출과 놓침의 FUEL을 다시 비교한다 | `auto`(문서) |
| W6 | 끝난 STAND의 transcript 폴더가 왜 사라지는지 알아낸다 | 무엇이 지우는지, atc 폴더에 보관 기간을 늘릴 수 있는지 읽기만 하는 조사. 하루 줄은 적지 않은 것을 되살릴 수 없다 | 문서만 |

## 10. Pilot's discretion

- `Bug`는 Linear 라벨로만 셌다.
- 더 일찍 시작한 STAND 셋을 "기대"에서 뺄 때 머지 시각이 아니라 claim 시각으로 가렸다.
- FUEL은 logbook의 cost 필드가 아니라 logbook의 토큰으로 가중한 대용 값을 써서 묶음을 한 잣대로 비교했다.
- `codebase-locator`는 뺀다고 썼다. 근거가 하루와 호출 0이지만 vendored 파일은 git에서 되돌릴 수 있다. SUPERVISOR가 한 번 더 점검할 때까지 두기로 해도 된다.
