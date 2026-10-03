---
name: atc-task
description: Linear ATC 이슈 하나(ATC-n)를 atc 저장소에서 구현해 PR로 올리고, 일을 맡긴 세션에 보고한다. "ATC-n 진행"처럼 ATC 이슈를 맡았을 때 쓴다. 규칙의 원본은 루트 CLAUDE.md이고, 이 skill은 그 순서와 점검표다.
---

# ATC 이슈 작업

규칙이 이 파일과 루트 `CLAUDE.md`가 다르면 `CLAUDE.md`를 따른다.

## 0. 배정 받기

ATC-<n> 배정은 두 갈래로 온다. 어느 쪽이든 CAPTAIN이 그 메시지에 바로 답한다(`READBACK`·`UNABLE`·`STANDBY`·`RECALL`의 형식은 루트 `CLAUDE.md` "교신").

- **OCC의 `[DISPATCH D-xxxx]` FLIGHT PLAN.** 대개 `BRIEF: DIRECT`와 함께 이슈 본문(목표·완료 기준·제약)이 담겨 온다(ATC-122). 최종 보고도 OCC에 보낸다(8절).
- **ENGINEERING이나 사용자가 직접 맡기는 지시.** 아래 "1. 명세 읽기"대로 이슈를 읽는다. 최종 보고도 그 세션에 보낸다(8절).

## 1. 명세 읽기

- `curl -s localhost:7700/api/dispatch/flight/ATC-<n>`으로 이슈 본문과 댓글을 읽는다. FLIGHT PLAN 메시지에 이미 본문이 담겨 있으면 다시 조회하지 않아도 된다. Linear에는 쓰지 않는다.
- 목표, 완료 기준(Done when·Exit criteria), 이 작업만의 제약을 확인한다. 지시가 `BRIEF: DIRECT`면 목표로 곧장 간다(`docs/dispatch.md` "DIRECT briefs"). 번호 붙은 단계가 있어도 목표와 완료 기준이 우선이다.
- 0절에서 이미 READBACK했으면 다시 답하지 않는다. 어느 쪽이든 끝까지 한 번에 진행한다.
- 명세에 없는 변경을 하게 되면 PR 본문에 따로 적는다.

## PILOT'S DISCRETION

- 흔한 애매함(이름, 화면 위치, 기본값, 문구, 명세의 작은 틀림)은 스스로 합리적인 기본값을 고르고 계속 간다. 고른 것과 이유는 PR 본문의 "Pilot's discretion" 절과 보고에 적는다.
- 멈춰서 먼저 묻는 것은 SUPERVISOR가 정할 일뿐이다: guard의 막는 조건, 운영 상태·기록 형식(`~/.local/state/atc/`)을 되돌리기 어렵게 바꾸는 것, 승인 게이트·브랜치 보호, 비용이나 외부에 쓰는 동작, 명세의 목표 자체가 맞지 않아 보일 때.
- 물을 때는 한 번에 모아 묻고, 답을 기다리는 동안 그 결정에 걸리지 않는 부분은 계속 만든다.
- **기존 기능을 지우는 것은 재량이 아니다**(ATC-495): 작업 지시서가 이름 붙이지 않았는데 이 작업이 기존 화면 구역·뷰·버튼·화면이 그리는 필드를 지우거나 납작하게 만들게 되면 지키거나 `BLOCKED`에 적어 일을 맡긴 세션이 정하게 한다(그 답에 걸리지 않는 부분은 계속 만든다). 지시서가 이름 붙인 지우기는 그대로 한다. 지시서는 화면이 하는 일의 전부가 아니니, 고치는 화면은 `origin/main`에서 먼저 읽는다.

## 2. 작업 위치

워크트리 도구를 쓰는 세션(백그라운드 AIRCRAFT)은 도구로 만든다. 승인을 묻지 않고 STAND가 `.claude/worktrees/` 아래에 생긴다:

```bash
git -C /home/c10/projects/atc fetch -q origin
# EnterWorktree name=atc-<n>-<짧은 이름>  → /home/c10/projects/atc/.claude/worktrees/atc-<n>-<짧은 이름>, 브랜치 worktree-atc-<n>-<짧은 이름>(origin/main 기준)
cp -al /home/c10/projects/atc/node_modules /home/c10/projects/atc/.claude/worktrees/atc-<n>-<짧은 이름>/node_modules
```

- 다음 FLIGHT로 옮길 때는 `ExitWorktree action=keep` 뒤 새 `EnterWorktree name=…`(지금 워크트리 안에서 `name`으로 또 만들면 오류). 브랜치 접두어는 `docs/rules.ko.md` "STAND 이름과 브랜치".
- 도구가 없는 세션은 옛 방식도 된다:

```bash
git -C /home/c10/projects/atc worktree add /home/c10/projects/worktrees/atc-<n>-<짧은 이름> -b claude/atc-<n>-<짧은 이름> origin/main
cp -al /home/c10/projects/atc/node_modules /home/c10/projects/worktrees/atc-<n>-<짧은 이름>/node_modules
```

- 금지 사항(main 체크아웃, stash, 운영 상태)은 루트 `CLAUDE.md` "작업 위치".
- 끝난 워크트리는 `git worktree remove <경로>`나 `ExitWorktree action=remove`로 치운다.

### 클라우드 세션 (`CLAUDE_CODE_REMOTE=true`, `docs/cloud.ko.md`)

- STAND는 세션의 clone이다: `EnterWorktree`·`cp -al` 없이 `claude/atc-<n>-<짧은 이름>` 브랜치에서 한다. Node 24와 `npm ci`는 시작 hook이 해 둔다.
- 명세는 FLIGHT PLAN·프롬프트 글에서 읽는다(`localhost:7700` 없음). Linear 커넥터가 켜져 있으면 읽기만 한다.
- `SendMessage`가 없으니 8절 보고(같은 고정 머리)는 세션 마지막 글과 PR 코멘트에 쓴다.
- Playwright MCP가 없다: 화면 FLIGHT는 로컬에서 한다. 못 하면 `BLOCKED`에 적는다.

## 3. 구현

- 방법 skill(파일럿 ATC-282, 가져온 것은 `THIRD_PARTY_NOTICES.md`): FLIGHT가 버그·실패하는 테스트·회귀이면 코드를 바꾸기 전에 Skill 도구로 `diagnosing-bugs`를 부른다. 그 단계(feedback loop → 재현·최소화 → 가설 → fix)는 이 흐름 안에서 돌고 STAND·검증·PR·보고 흐름은 바뀌지 않는다.
- 어디에 있는지, 어떻게 도는지 찾으려고 코드를 넓게 읽기 전에 `codebase-locator`(경로만 돌려줌)와 `codebase-analyzer`(`file:line`으로 설명) sub-agent에 찾기를 맡기고, 메인 컨텍스트에는 그 결과만 둔다.
- 충돌하면 루트 `CLAUDE.md` > `atc-task` > 가져온 skill·agent 순으로 따른다. 코드 규칙은 루트 `CLAUDE.md` "코드".

## 4. 문서 점검표

- [ ] 루트 `CLAUDE.md` "용어와 문서"와 `docs/rules.ko.md` "문서"의 항목을 하나씩 확인했다: 영어·한국어판, 관제 폴더의 한국어 원본, changelog 조각(`node server/changelog-fold.ts --check`), `docs/guide/`와 `DOC_NAV`.
- [ ] 설계 문서의 상태 표시는 고치지 않고, 만든 것은 그 기능 절 바로 뒤의 자기 절(`### F7 as built (ATC-57)`)에 적었다(`docs/rules.ko.md` "계획").
- [ ] 항공 용어는 영어로 썼다.

## 5. 검증

- 루트 `CLAUDE.md` "검증"의 세 검사를 모두 통과시킨다.
- 끝까지 확인할 때는 Skill 도구로 `test-server`를 부른다(ATC-357). 직접 띄우는 규칙은 루트 `CLAUDE.md` "검증". 확인이 실제 PR 자료를 필요로 할 때만 `ATC_GITHUB`를 빼고, 그때는 짧게만 돌린다.
- 화면을 바꿨으면 Playwright로 4개 폭(390, 768, 1280, 1600) × 3개 테마(`radar`, `night`, `cockpit`)를 본다. 가로 넘침이 없는지도 확인한다.
- 화면 FLIGHT(`web/`나 ANNUNCIATOR 화면을 바꾸는 FLIGHT)는 PR 전에 Skill 도구로 `ui-review`(mode `diff`)를 부른다(ATC-293, 가져온 규칙은 `THIRD_PARTY_NOTICES.md`). 그 출력 블록을 PR 본문의 `docs/design-language.md` 5절 점검표 답 옆에 그대로 붙이고, Blocker는 고치거나 보고의 `BLOCKED`에 적는다. 디자인 언어가 정한 값은 결함이 아니고, `CONFLICT`로 표시된 가져온 규칙은 따르지 않고 블록의 "Conflicts seen"에만 적는다.
- 끝나면 서버를 끄고 임시 폴더와 스크린샷을 지운다.

## 6. 등급 확인

```bash
git diff --name-only origin/main...HEAD | node deploy/landing-tier.mjs
```

- 등급의 뜻과 머지 방식은 루트 `CLAUDE.md` "git과 PR". `user`거나 ESCALATE될 PR은 7절의 Behavior change 절이 꼭 있어야 한다.

## 7. PR

- PR 제목 끝은 `(ATC-<n>)`, 본문 첫 줄은 `Fixes ATC-<n>`이다. 후속 PR은 `Refs ATC-<n>`.
- 본문에 요약, 명세와 다르게 한 점, PILOT'S DISCRETION으로 고른 기본값, 등급, 시험 계획(`[x]` 체크)을 적는다.
- **`Removed:` 줄**(ATC-495): 본문에 `Removed: <이 diff가 지우는 사용자에게 보이는 것, `;`로 나눠>` 한 줄. 없으면 `Removed: none`. 지시서가 이름 붙인 지우기는 어느 줄이 요구했는지 적는다. 줄이 없거나 diff와 다르면 MCC INSPECTION이 P1, 이름 없는 지우기는 ESCALATE(`docs/mcc.md` 4.1).
- **"Behavior change" 절**(ATC-360, `user`·ESCALATE PR): SUPERVISOR가 diff를 읽지 않고 동작이 무엇이 바뀌는지 보게 하는 그림이다. 절 안에 ``` 코드 블록 하나: `BEFORE`와 `AFTER` 두 줄(또는 mermaid `flowchart`)에 트리거 → 단계 → 결과를 화살표로 잇고 바뀐 곳에 `*`를 붙인다. PR 서랍은 코드 블록을 그대로 보여 준다. 동작이 바뀌지 않으면 한 줄 `Behavior change: none`. 그림은 diff와 같아야 한다. 예:

  ````
  ## Behavior change
  ```
  BEFORE: PR opened → MCC INSPECTION → pass → user tier: wait for SUPERVISOR
  AFTER:  PR opened → MCC INSPECTION* (also checks the diagram) → pass → user tier: wait for SUPERVISOR
  ```
  ````

## 8. 보고

일을 맡긴 세션에만 `SendMessage`로 보고한다(0절: FLIGHT PLAN으로 받았으면 OCC, 직접 지시로 받았으면 ENGINEERING이나 사용자). 보고는 영어다(루트 `CLAUDE.md` "교신").

보고는 **고정 머리와 고정 줄**로 시작한다(ATC-124). 받은 세션이 `atcctl dispatch report`로 한 번에 기록하는 칸이라 모양을 바꾸지 않는다:

```
[TEAM_X → OCC] ARRIVED ATC-<n> · PR #<번호>
TIER auto|flagged|user
TESTS <통과>/<전체> · tsc ✓ · build ✓
DISCRETION <수> — <하나씩 한 줄, 없으면 none>
BLOCKED none | <막힌 점 한 줄씩>
<자유 요약>
```

- `TESTS` 줄은 늘 쓴다. 코드나 테스트가 바뀌지 않은 PR(문서·설정·CI만)은 숫자를 지어내지 말고 `TESTS n/a`로 쓴다(ATC-209): `TESTS n/a · tsc ✓ · build ✓`. 받은 OCC는 `--tests n/a`로 그대로 기록한다. 코드가 바뀐 PR은 늘 `<통과>/<전체>`다.
- 첫 줄의 `→ OCC`는 FLIGHT PLAN으로 받았을 때, 직접 지시면 `→ ENGINEERING`(사용자에게는 같은 꼴로 대화에 쓴다). PR이 없는 SURVEY·CHECK FLIGHT는 `PR #<번호>` 대신 `RESULT <링크>`를 쓴다.
- `TIER`는 6절 등급, `DISCRETION`은 PILOT'S DISCRETION으로 고른 것의 수(줄마다 무엇을 왜), `BLOCKED`는 막힌 점이나 SUPERVISOR가 결정할 일이다. 지우기 물음(위 PILOT'S DISCRETION)도 여기에 적는다. tsc나 build가 실패했으면 ✓ 대신 ✗와 이유를 적는다.
- 고정 줄 뒤 자유 요약에는: 한 일 3~5개, 명세와 다르게 한 점, `flagged`면 바뀐 관제 규칙, 검증 결과(시험 서버와 Playwright에서 확인한 것을 글로), PR 링크.

같은 파일을 고치는 다른 ATC 작업이 먼저 머지되면, `origin/main`을 병합하고(rebase 없이) 맨 `git push`로 다시 올린 뒤 알린다. `GO AROUND`·`FIX`는 루트 `CLAUDE.md` "교신"의 행동 지시이고, 검증은 5절이다.

## 9. Gotchas

앞선 FLIGHT가 겪은 실패 중 어느 규칙에도 없는 것만 둔다. 항목마다 `origin/main`에서 참이어야 하고, 코드로 없앨 수 있으면 코드를 고치고 항목을 지운다.

- `server/config.ts`는 import할 때 환경을 읽는다(`ATC_STATE_DIR`, `HOME`). 테스트가 `process.env`를 먼저 정하지 않고 정적 import하면 운영 상태 폴더 `~/.local/state/atc/`를 읽는다. 2026-09-30에 그렇게 읽은 테스트가 호스트 OOM을 내 모든 백그라운드 세션이 멈췄다(PR #272). `server/reposition-run.test.ts`처럼 임시 폴더를 환경에 넣고 동적으로 import한다. config 주입(ATC-343)이 들어가면 이 항목을 지운다.
- `gh pr edit --body-file`은 GraphQL "Projects (classic)" 오류로 실패한다. `gh api -X PATCH repos/chaehy5665/atc/pulls/<n> -F body=@<파일>`을 쓴다.
- Playwright MCP는 스크린샷을 `/tmp/playwright-mcp/` 아래 절대 경로로만 저장한다(`~/.claude/playwright-mcp.json`의 `outputDir`). 상대 경로나 다른 경로를 쓰면 PNG가 STAND나 main 체크아웃(공개 저장소)에 떨어진다. 커밋 전에 두 곳의 `git status`에서 남은 PNG를 확인한다.
- `cp -al node_modules`는 같은 파일시스템에서만 된다. `/tmp`(tmpfs)에는 안 된다.
- `origin/main`은 FLIGHT 도중 여러 번 움직인다. 끝까지 확인(시험 서버·Playwright) 전에 한 번, PR 직전에 한 번 `git fetch`·병합한다.
- Playwright 루프에서 해시만 다른 같은 URL로 `page.goto`하면 다시 불러오지 않아 React 상태(열린 설정 창 등)가 남는다. `/?i=${n}#tab`처럼 쿼리를 바꾼다.

### 새 gotcha 제안

`.claude/`를 곁에서 고치지 않는다. 겪은 실패가 위에도 규칙에도 없으면 8절 보고의 자유 요약에 한 줄을 더한다: `GOTCHA? <사실 한 줄> · <증거: PR, 파일:줄, 날짜>`. 받은 세션(OCC, ENGINEERING)이 참인지 확인해 이 절에 넣는 PR(등급 `user`)을 올린다. 이 절을 직접 고치는 PR은 항목마다 코드·실행으로 확인한 근거를 본문에 적는다.
