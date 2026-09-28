---
name: atc-task
description: Linear ATC 이슈 하나(ATC-n)를 atc 저장소에서 구현해 PR로 올리고, 일을 맡긴 세션에 보고한다. "ATC-n 진행"처럼 ATC 이슈를 맡았을 때 쓴다. 규칙의 원본은 루트 CLAUDE.md이고, 이 skill은 그 순서와 점검표다.
---

# ATC 이슈 작업

규칙이 이 파일과 루트 `CLAUDE.md`가 다르면 `CLAUDE.md`를 따른다.

## 1. 명세 읽기

- `curl -s localhost:7700/api/dispatch/flight/ATC-<n>`으로 이슈 본문과 댓글을 읽는다. Linear에는 쓰지 않는다.
- 목표, 완료 기준(Done when·Exit criteria), 이 작업만의 제약을 확인한다. 지시가 `BRIEF: DIRECT`면 목표로 곧장 간다(`docs/dispatch.md` "DIRECT briefs"). 번호 붙은 단계가 있어도 목표와 완료 기준이 우선이다.
- 받았으면 일을 맡긴 세션에 `READBACK ATC-<n>`으로 답하고, 끝까지 한 번에 진행한다.
- 명세에 없는 변경을 하게 되면 PR 본문에 따로 적는다.

## PILOT'S DISCRETION

- 흔한 애매함(이름, 화면 위치, 기본값, 문구, 명세의 작은 틀림)은 스스로 합리적인 기본값을 고르고 계속 간다. 고른 것과 이유는 PR 본문의 "Pilot's discretion" 절과 보고에 적는다.
- 멈춰서 먼저 묻는 것은 SUPERVISOR가 정할 일뿐이다: guard의 막는 조건, 운영 상태·기록 형식(`~/.local/state/atc/`)을 되돌리기 어렵게 바꾸는 것, 승인 게이트·브랜치 보호, 비용이나 외부에 쓰는 동작, 명세의 목표 자체가 맞지 않아 보일 때.
- 물을 때는 한 번에 모아 묻고, 답을 기다리는 동안 그 결정에 걸리지 않는 부분은 계속 만든다.

## 2. 작업 위치

```bash
git -C /home/c10/projects/atc fetch -q origin
git -C /home/c10/projects/atc worktree add /home/c10/projects/worktrees/atc-<n>-<짧은 이름> -b claude/atc-<n>-<짧은 이름> origin/main
cp -al /home/c10/projects/atc/node_modules /home/c10/projects/worktrees/atc-<n>-<짧은 이름>/node_modules
```

- main 체크아웃(`/home/c10/projects/atc`)과 운영 상태(`~/.local/state/atc/`)는 손대지 않는다.
- 맨 `git stash`를 쓰지 않는다.

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
- 끝까지 확인할 때는 시험 서버를 띄운다: `(set -a; . /home/c10/projects/atc/.env.local; set +a; ATC_STATE_DIR=<임시 폴더> ATC_PORT=7702 node server/index.ts)`
  - 임시 폴더에는 등록부(`airports.json`, `fleet.json`)만 복사한다.
  - `.env.local`은 복사하거나 출력하지 않는다.
  - 다른 팀이 7702를 쓰고 있으면 7703이나 7704를 쓴다.
- 화면을 바꿨으면 Playwright로 4개 폭(390, 768, 1280, 1600) × 3개 테마(`radar`, `night`, `cockpit`)를 본다. 가로 넘침이 없는지도 확인한다.
- 시험 중에 실제 팀 세션에 메시지를 보내지 않는다.
- 끝나면 서버를 끄고 임시 폴더와 스크린샷을 지운다.

## 6. 등급 확인

```bash
git diff --name-only origin/main...HEAD | node deploy/landing-tier.mjs
```

- `auto`나 `flagged`: CI가 통과하면 사용자가 머지한다(MCC가 `land` 모드가 되면 MCC가 INSPECTION 뒤 착륙).
- `user`: 사용자가 머지한다. guard, 루트 `.claude/`, 루트 `CLAUDE.md`, `.github/`, 의존성, `hooks/`, `deploy/`를 바꾸면 이 등급이다.

## 7. PR

- 커밋 메시지와 PR 제목, 본문은 영어로 쓴다. attribution 줄은 넣지 않는다.
- PR 제목 끝은 `(ATC-<n>)`, 본문 첫 줄은 `Fixes ATC-<n>`이다. 후속 PR은 `Refs ATC-<n>`.
- 본문에 요약, 명세와 다르게 한 점, PILOT'S DISCRETION으로 고른 기본값, 등급, 시험 계획(`[x]` 체크)을 적는다. 끝은 `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- 머지하지 않는다.

## 8. 보고

일을 맡긴 세션(보통 ENGINEERING)에만 `SendMessage`로 보고한다. 다른 팀 세션에는 보내지 않는다.

- 첫 줄: `[TEAM_X → ENGINEERING] ATC-<n>: PR #<번호> <링크>`
- 한 일을 요약한다(항목 3~5개).
- 명세와 다르게 한 점, PILOT'S DISCRETION으로 고른 것과 그 이유를 적는다.
- 등급을 적고, `flagged`면 바뀐 관제 규칙을 적는다.
- 검증 결과를 적는다: 테스트 수, tsc, build, 시험 서버와 Playwright에서 확인한 것. 스크린샷은 올리지 않고 글로 적는다(공개 저장소, 루트 CLAUDE.md).
- 막힌 점이나 SUPERVISOR가 결정할 일을 적는다.

같은 파일을 고치는 다른 ATC 작업이 먼저 머지되면, `origin/main` 위로 rebase하고 force-with-lease로 다시 올린 뒤 알린다.
