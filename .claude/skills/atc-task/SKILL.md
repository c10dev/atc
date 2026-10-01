---
name: atc-task
description: Linear ATC 이슈 하나(ATC-n)를 atc 저장소에서 구현해 PR로 올리고, 일을 맡긴 세션에 보고한다. "ATC-n 진행"처럼 ATC 이슈를 맡았을 때 쓴다. 규칙의 원본은 루트 CLAUDE.md이고, 이 skill은 그 순서와 점검표다.
---

# ATC 이슈 작업

규칙이 이 파일과 루트 `CLAUDE.md`가 다르면 `CLAUDE.md`를 따른다.

## 0. 배정 받기

ATC-<n> 배정은 두 갈래로 온다. 어느 쪽이든 CAPTAIN이 그 메시지에 바로 답한다(루트 `CLAUDE.md` "교신").

- **OCC(운항관제 세션)의 `[DISPATCH D-xxxx]` FLIGHT PLAN.** 대개 `BRIEF: DIRECT`와 함께 이슈 본문(목표·완료 기준·제약)을 메시지에 담아 온다. 맡으면 그 메시지에 `READBACK D-xxxx`로 답하고, 맡지 못하면 `UNABLE D-xxxx — 사유`, 시간이 필요하면 `STANDBY D-xxxx`로 답한다(ATC-122). 일하는 중에 `[DISPATCH D-xxxx] RECALL`을 받으면 즉시 멈추고 `READBACK D-xxxx RECALL`로 답한다. 이때 최종 보고도 OCC에 보낸다(8절).
- **ENGINEERING이나 사용자가 직접 맡기는 지시.** 아래 "1. 명세 읽기"대로 이슈를 읽고 `READBACK ATC-<n>`으로 그 세션에 답한다. 최종 보고도 그 세션에 보낸다(8절).

## 1. 명세 읽기

- `curl -s localhost:7700/api/dispatch/flight/ATC-<n>`으로 이슈 본문과 댓글을 읽는다. FLIGHT PLAN 메시지에 이미 본문이 담겨 있으면 다시 조회하지 않아도 된다. Linear에는 쓰지 않는다.
- 목표, 완료 기준(Done when·Exit criteria), 이 작업만의 제약을 확인한다. 지시가 `BRIEF: DIRECT`면 목표로 곧장 간다(`docs/dispatch.md` "DIRECT briefs"). 번호 붙은 단계가 있어도 목표와 완료 기준이 우선이다.
- 0절에서 이미 READBACK했으면 다시 답하지 않는다. 직접 지시로 받았고 아직 답하지 않았으면 일을 맡긴 세션에 `READBACK ATC-<n>`으로 답한다. 어느 쪽이든 끝까지 한 번에 진행한다.
- 명세에 없는 변경을 하게 되면 PR 본문에 따로 적는다.

## PILOT'S DISCRETION

- 흔한 애매함(이름, 화면 위치, 기본값, 문구, 명세의 작은 틀림)은 스스로 합리적인 기본값을 고르고 계속 간다. 고른 것과 이유는 PR 본문의 "Pilot's discretion" 절과 보고에 적는다.
- 멈춰서 먼저 묻는 것은 SUPERVISOR가 정할 일뿐이다: guard의 막는 조건, 운영 상태·기록 형식(`~/.local/state/atc/`)을 되돌리기 어렵게 바꾸는 것, 승인 게이트·브랜치 보호, 비용이나 외부에 쓰는 동작, 명세의 목표 자체가 맞지 않아 보일 때.
- 물을 때는 한 번에 모아 묻고, 답을 기다리는 동안 그 결정에 걸리지 않는 부분은 계속 만든다.

## 2. 작업 위치

워크트리 도구를 쓰는 세션(백그라운드 AIRCRAFT)은 도구로 만든다. 승인을 묻지 않고 STAND가 `.claude/worktrees/` 아래에 생긴다:

```bash
git -C /home/c10/projects/atc fetch -q origin
# EnterWorktree name=atc-<n>-<짧은 이름>  → /home/c10/projects/atc/.claude/worktrees/atc-<n>-<짧은 이름>, 브랜치 worktree-atc-<n>-<짧은 이름>(origin/main 기준)
cp -al /home/c10/projects/atc/node_modules /home/c10/projects/atc/.claude/worktrees/atc-<n>-<짧은 이름>/node_modules
```

- 다음 FLIGHT로 옮길 때는 `ExitWorktree action=keep` 뒤 새 `EnterWorktree name=…`. 지금 워크트리 안에서 `name`으로 또 만들면 오류이고, `EnterWorktree path=`로 `.claude/worktrees/` 밖(`/home/c10/projects/worktrees/…`)에 들어가면 승인을 물어 백그라운드 세션이 멈춘다.
- 도구가 없는 세션은 옛 방식도 된다:

```bash
git -C /home/c10/projects/atc worktree add /home/c10/projects/worktrees/atc-<n>-<짧은 이름> -b claude/atc-<n>-<짧은 이름> origin/main
cp -al /home/c10/projects/atc/node_modules /home/c10/projects/worktrees/atc-<n>-<짧은 이름>/node_modules
```

- main 체크아웃(`/home/c10/projects/atc`)의 파일과 운영 상태(`~/.local/state/atc/`)는 손대지 않는다. main 체크아웃에서 `git clean`·`git stash`를 쓰지 않는다(`.claude/worktrees/`가 안에 있다).
- 맨 `git stash`를 쓰지 않는다.
- 끝난 워크트리는 `git worktree remove <경로>`나 `ExitWorktree action=remove`로 치운다.

## 3. 구현

- 계산은 순수 함수로 두고 `node:test`로 테스트한다.
- 기록은 추가만 하는 JSONL, 설정은 원자적으로 바꿔 쓰는 JSON이다.
- 화면 색과 글꼴은 `web/src/styles.css`의 `:root` 토큰만 쓴다.
- guard(`*guard*.mjs`)의 막는 조건을 약하게 만들어야 하면 먼저 일을 맡긴 세션에 묻는다(SUPERVISOR 결정).

## 4. 문서 점검표

- [ ] 영어판과 한국어판을 함께 고쳤다: `README`, `docs/<주제>`, `server/README`, 폴더 README.
- [ ] 관제 세션 폴더(`occ/`, `crosscheck/`, `controller/`)의 `CLAUDE.md`와 `SKILL.md`는 한국어판이 원본이다. 한국어판을 먼저 고치고 `*.en.md`를 번역했다.
- [ ] `CHANGELOG.md`·`CHANGELOG.ko.md`는 고치지 않고 조각 한 쌍 `changelog.d/ATC-<n>.md`·`ATC-<n>.ko.md`를 더했다(`### Added`처럼 절 제목 아래 항목, `changelog.d/README.ko.md`). `node server/changelog-fold.ts --check`가 통과한다.
- [ ] 사용자가 쓰는 방법이 바뀌었으면 `docs/guide/`를 고쳤다. 새 쪽이면 `web/src/views/Docs.tsx`의 `DOC_NAV`에 넣었다.
- [ ] 설계 문서의 상태 표시(Implementation order 표의 ✅, `Status:` 줄, "Not built yet"에서 옮기기, `docs/guide/stages.md`의 단계)는 고치지 않았다. ENGINEERING이 머지 뒤 고친다. 만든 것은 그 기능을 설명하는 절 바로 뒤에 번호 없는 자기 절(`### F7 as built (ATC-57)`)로 적었다.
- [ ] 항공 용어는 영어로 썼다(FLIGHT, HOLD, READBACK …).

## 5. 검증

- `npm test`, `npx tsc --noEmit -p .`, `npx vite build`
- 끝까지 확인할 때는 시험 서버를 띄운다: `(set -a; . /home/c10/projects/atc/.env.local; set +a; ATC_GITHUB=off ATC_STATE_DIR=<임시 폴더> ATC_PORT=7702 exec node server/index.ts) & echo $! > <임시 폴더>/server.pid`
  - `ATC_GITHUB=off`는 서버가 GitHub(`gh`)를 부르지 않게 한다(시험 서버가 SUPERVISOR의 토큰으로 폴링하지 않게). 확인이 실제 PR 자료를 필요로 할 때만 빼고, 그때는 짧게만 돌린다.
  - 직접 만든 실행 스크립트도 PID 파일을 반드시 쓴다.
  - 끌 때는 `kill "$(cat <임시 폴더>/server.pid)"`만 쓴다. `pkill`·`killall`·`kill $(pgrep …)`처럼 이름·패턴으로 죽이지 않고, 내가 띄우지 않은 프로세스는 건드리지 않는다(운영 7700이 죽는다, 2026-09-29 사고. `hooks/kill-guard.mjs`가 막는다).
  - 임시 폴더에는 등록부(`airports.json`, `fleet.json`)만 복사한다.
  - `.env.local`은 복사하거나 출력하지 않는다.
  - 다른 팀이 7702를 쓰고 있으면 7703이나 7704를 쓴다.
- 화면을 바꿨으면 Playwright로 4개 폭(390, 768, 1280, 1600) × 3개 테마(`radar`, `night`, `cockpit`)를 본다. 가로 넘침이 없는지도 확인한다.
- 화면 FLIGHT(`web/`나 ANNUNCIATOR 화면을 바꾸는 FLIGHT)는 PR 전에 Skill 도구로 `ui-review`(mode `diff`)를 부른다(ATC-293, 가져온 규칙은 `THIRD_PARTY_NOTICES.md`). 그 출력 블록을 PR 본문의 `docs/design-language.md` 5절 점검표 답 옆에 그대로 붙이고, Blocker는 고치거나 보고의 `BLOCKED`에 적는다. 디자인 언어가 정한 값은 결함이 아니고, `CONFLICT`로 표시된 가져온 규칙은 따르지 않고 블록의 "Conflicts seen"에만 적는다. 스크린샷은 올리지 않는다.
- 시험 중에 실제 팀 세션에 메시지를 보내지 않는다.
- 끝나면 서버를 끄고 임시 폴더와 스크린샷을 지운다.

## 6. 등급 확인

```bash
git diff --name-only origin/main...HEAD | node deploy/landing-tier.mjs
```

- `auto`나 `flagged`: CI(`check`)가 통과하고 MCC INSPECTION이 `pass`면 MCC가 착륙시키고, `land+rts` 모드(2026-09-29부터)라 RETURN TO SERVICE로 배포까지 한다. 사용자가 먼저 머지해도 된다. `flagged`면 PR 본문과 보고에 바뀐 관제 규칙과 외부 부작용 파일을 따로 적는다.
- `user`: 사용자가 머지한다. guard, 루트 `.claude/`, 루트 `CLAUDE.md`, `.github/`, 의존성, `hooks/`, `deploy/`를 바꾸면 이 등급이다.

## 7. PR

- 커밋 메시지와 PR 제목, 본문은 영어로 쓴다. attribution 줄은 넣지 않는다.
- PR 제목 끝은 `(ATC-<n>)`, 본문 첫 줄은 `Fixes ATC-<n>`이다. 후속 PR은 `Refs ATC-<n>`.
- 본문에 요약, 명세와 다르게 한 점, PILOT'S DISCRETION으로 고른 기본값, 등급, 시험 계획(`[x]` 체크)을 적는다. 끝은 `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- 머지하지 않는다.

## 8. 보고

일을 맡긴 세션에만 `SendMessage`로 보고한다(0절: FLIGHT PLAN으로 받았으면 OCC, 직접 지시로 받았으면 ENGINEERING이나 사용자). 다른 팀 세션에는 보내지 않는다. 세션끼리 주고받는 글이라 보고는 영어로 쓴다(루트 `CLAUDE.md` "교신", ATC-126). 사용자와의 대화만 한국어다. SUPERVISOR가 읽는 글(이 세션의 턴 글, 질문, 요약)은 한국어로 쓰고 일본어·중국어는 쓰지 않는다(ATC-150).

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
- `TIER`는 6절 등급, `DISCRETION`은 PILOT'S DISCRETION으로 고른 것의 수(줄마다 무엇을 왜), `BLOCKED`는 막힌 점이나 SUPERVISOR가 결정할 일이다. tsc나 build가 실패했으면 ✓ 대신 ✗와 이유를 적는다.
- 고정 줄 뒤 자유 요약에는: 한 일 3~5개, 명세와 다르게 한 점, `flagged`면 바뀐 관제 규칙, 검증 결과(시험 서버와 Playwright에서 확인한 것. 스크린샷은 올리지 않고 글로, 공개 저장소, 루트 CLAUDE.md), PR 링크.

같은 파일을 고치는 다른 ATC 작업이 먼저 머지되면, `origin/main` 위로 rebase하고 force-with-lease로 다시 올린 뒤 알린다. TOWER가 `GO AROUND`(ATC-128)를 보내면 이 일을 바로 한다: `READBACK C-xxxx` → rebase(또는 병합) → 충돌 조각을 대화에 보이기 → 5절 검증 → `git push --force-with-lease` → PR 본문에 푼 내용. 두 PR이 같은 동작을 다르게 바꿨으면 풀지 말고 `UNABLE C-xxxx — 사유`.
